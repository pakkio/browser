//! Video: codec check, seekable fragmented-MP4 streaming through ffmpeg (rewrap when possible,
//! re-encode otherwise), subtitles and cached thumbnails (file-handlers.js, video-transcode.js,
//! video-codec-checker.js).

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use axum::body::Body;
use axum::extract::State;
use axum::http::header;
use axum::response::Response;
use bytes::Bytes;
use md5::{Digest, Md5};
use serde_json::{json, Map, Value};
use tokio::io::AsyncReadExt;
use tokio::sync::Semaphore;

use crate::app::{json, json_status, text, AppRef, Ctx};
use crate::jsutil::{self, epoch_ms, jnum, num_to_string, parse_float, parse_int};
use crate::util::{command, run, KeyedLocks};

pub struct VideoState {
    thumbs: Semaphore,
    thumb_inflight: KeyedLocks,
}

impl Default for VideoState {
    fn default() -> Self {
        let cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        VideoState { thumbs: Semaphore::new(cpus.clamp(2, 4)), thumb_inflight: KeyedLocks::default() }
    }
}

// ---------------------------------------------------------------------------------------------
// Codec check

fn copy_if_present(dst: &mut Map<String, Value>, key: &str, src: &Value, from: &str) {
    if let Some(v) = src.get(from) {
        if !v.is_null() {
            dst.insert(key.into(), v.clone());
        }
    }
}

fn num_field(src: &Value, key: &str, float: bool) -> Value {
    let s = match src.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    };
    if float {
        jnum(parse_float(&s).unwrap_or(0.0))
    } else {
        json!(parse_int(&s).unwrap_or(0))
    }
}

/// Codec details and browser compatibility from ffprobe.
pub async fn check_codec(file: &str) -> Value {
    let failure = |error: String, message: String, codec: Option<&str>| {
        let mut v = json!({ "success": false, "compatible": false, "needsTranscoding": true, "error": error, "message": message });
        if let Some(c) = codec {
            v["codec"] = json!(c);
        }
        v
    };
    if !matches!(run("ffprobe", &["-version"], Duration::from_secs(15)).await, Ok(o) if o.success()) {
        return failure(
            "ffprobe not available".into(),
            "ffprobe is not installed or not in PATH. Please install ffmpeg to use this feature.".into(),
            None,
        );
    }
    let out = match run("ffprobe", &["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file], Duration::from_secs(60)).await {
        Ok(o) if o.success() => o,
        Ok(o) => {
            let msg = format!("Command failed: ffprobe -v quiet -print_format json -show_format -show_streams \"{}\"\n{}", file, o.stderr_str());
            return failure(msg.clone(), format!("Failed to analyze video file: {}", msg), Some("error"));
        }
        Err(e) => return failure(e.to_string(), format!("Failed to analyze video file: {}", e), Some("error")),
    };
    let info: Value = match serde_json::from_slice(&out.stdout) {
        Ok(v) => v,
        Err(e) => return failure(e.to_string(), format!("Failed to analyze video file: {}", e), Some("error")),
    };
    let streams = info.get("streams").and_then(Value::as_array).cloned().unwrap_or_default();
    let Some(video) = streams.iter().find(|s| s.get("codec_type").and_then(Value::as_str) == Some("video")) else {
        return failure("No video stream found".into(), "The file does not contain a video stream.".into(), Some("unknown"));
    };
    let codec = video.get("codec_name").and_then(Value::as_str).unwrap_or("").to_lowercase();
    let compatible = ["h264", "vp8", "vp9", "av1", "theora"].contains(&codec.as_str());
    let fmt = info.get("format").cloned().unwrap_or(Value::Null);
    let mut format = Map::new();
    copy_if_present(&mut format, "filename", &fmt, "filename");
    copy_if_present(&mut format, "format_name", &fmt, "format_name");
    copy_if_present(&mut format, "format_long_name", &fmt, "format_long_name");
    format.insert("duration".into(), num_field(&fmt, "duration", true));
    format.insert("size".into(), num_field(&fmt, "size", false));
    format.insert("bit_rate".into(), num_field(&fmt, "bit_rate", false));
    let mut v = Map::new();
    for (k, from) in [
        ("codec_name", "codec_name"), ("codec_long_name", "codec_long_name"), ("profile", "profile"), ("level", "level"),
        ("width", "width"), ("height", "height"), ("aspect_ratio", "display_aspect_ratio"), ("pix_fmt", "pix_fmt"),
        ("frame_rate", "r_frame_rate"),
    ] {
        copy_if_present(&mut v, k, video, from);
    }
    v.insert("bit_rate".into(), num_field(video, "bit_rate", false));
    let audio: Vec<Value> = streams
        .iter()
        .filter(|s| s.get("codec_type").and_then(Value::as_str) == Some("audio"))
        .map(|s| {
            let mut a = Map::new();
            copy_if_present(&mut a, "codec_name", s, "codec_name");
            copy_if_present(&mut a, "codec_long_name", s, "codec_long_name");
            copy_if_present(&mut a, "profile", s, "profile");
            a.insert("sample_rate".into(), num_field(s, "sample_rate", false));
            copy_if_present(&mut a, "channels", s, "channels");
            a.insert("bit_rate".into(), num_field(s, "bit_rate", false));
            Value::Object(a)
        })
        .collect();
    let name = video.get("codec_name").and_then(Value::as_str).unwrap_or("undefined");
    json!({
        "success": true,
        "compatible": compatible,
        "needsTranscoding": !compatible,
        "reason": if compatible { "Browser-compatible codec".to_string() } else { format!("Codec {} not browser-compatible", name) },
        "format": format,
        "video": v,
        "audio": audio,
    })
}

// ---------------------------------------------------------------------------------------------
// Transcode plan

fn avc_profile(name: &str) -> Option<&'static str> {
    match name {
        "Baseline" | "Constrained Baseline" => Some("42"),
        "Main" => Some("4d"),
        "Extended" => Some("58"),
        "High" => Some("64"),
        _ => None,
    }
}

/// copy: H.264 + AAC-LC (or silent), rewrap only; audio: H.264 with other audio, encode the
/// audio; full: re-encode everything.
pub fn plan(info: &Value) -> &'static str {
    if info["success"] != json!(true) || info.get("video").is_none() {
        return "full";
    }
    let v = &info["video"];
    let h264 = v["codec_name"].as_str().unwrap_or("").eq_ignore_ascii_case("h264")
        && matches!(v["pix_fmt"].as_str(), Some("yuv420p" | "yuvj420p"))
        && v["profile"].as_str().and_then(avc_profile).is_some();
    if !h264 {
        return "full";
    }
    let Some(a) = info["audio"].as_array().and_then(|a| a.first()) else { return "copy" };
    let lc = a["codec_name"].as_str().unwrap_or("").eq_ignore_ascii_case("aac") && a["profile"].as_str() == Some("LC");
    if lc { "copy" } else { "audio" }
}

/// MSE type string of what the stream produces.
pub fn stream_mime(info: &Value, mode: &str) -> String {
    let mut video = "avc1.640029".to_string();
    if mode != "full" {
        let profile = info["video"]["profile"].as_str().and_then(avc_profile).unwrap_or("64");
        let level_raw = match &info["video"]["level"] {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            _ => String::new(),
        };
        let level = parse_int(&level_raw).filter(|&l| l != 0).unwrap_or(40).clamp(0, 255);
        video = format!("avc1.{}00{:02x}", profile, level);
    }
    let has_audio = info["audio"].as_array().map(|a| !a.is_empty()).unwrap_or(false);
    let codecs = if has_audio || mode == "full" { format!("{}, mp4a.40.2", video) } else { video };
    format!("video/mp4; codecs=\"{}\"", codecs)
}

pub fn stream_args(file: &str, mode: &str, start: f64) -> Vec<String> {
    let mut a: Vec<String> = vec!["-fflags".into(), "+genpts".into()];
    if start > 0.0 {
        a.extend(["-ss".into(), num_to_string(start)]);
    }
    a.extend(["-i".into(), file.into(), "-map".into(), "0:v:0".into(), "-map".into(), "0:a:0?".into(), "-sn".into()]);
    if mode == "full" {
        for s in ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1", "-g", "48"] {
            a.push(s.into());
        }
    } else {
        a.extend(["-c:v".into(), "copy".into()]);
    }
    if mode == "copy" {
        a.extend(["-c:a".into(), "copy".into()]);
    } else {
        for s in ["-c:a", "aac", "-b:a", "160k", "-ac", "2"] {
            a.push(s.into());
        }
    }
    for s in ["-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "-"] {
        a.push(s.into());
    }
    a
}

/// DTS (seconds) of the first video packet ffmpeg reads when seeking to `time`.
async fn first_dts(file: &str, time: f64) -> Option<f64> {
    let t = num_to_string(time);
    let mut args = vec!["-v", "error"];
    if time > 0.0 {
        args.extend(["-ss", &t]);
    }
    args.extend(["-i", file, "-map", "0:v:0", "-c", "copy", "-frames:v", "1", "-copyts", "-f", "framecrc", "-"]);
    let out = run("ffmpeg", &args, Duration::from_secs(15)).await.ok()?;
    let s = out.stdout_str();
    let base = regex::Regex::new(r"(?m)^#tb 0: (\d+)/(\d+)").unwrap().captures(&s)?;
    let packet = regex::Regex::new(r"(?m)^0,\s*(-?\d+),").unwrap().captures(&s)?;
    let (n, num, den): (f64, f64, f64) = (packet[1].parse().ok()?, base[1].parse().ok()?, base[2].parse().ok()?);
    Some(n * num / den)
}

/// Where a stream asked to begin at `time` really starts: a rewrap begins on a keyframe.
pub async fn find_start_point(file: &str, mode: &str, time: f64) -> f64 {
    if !(time > 0.0) {
        return 0.0;
    }
    if mode == "full" {
        return time;
    }
    let (at, origin) = tokio::join!(first_dts(file, time), first_dts(file, 0.0));
    match (at, origin) {
        (Some(a), Some(o)) => (a - o).min(time).max(0.0),
        _ => time,
    }
}

// ---------------------------------------------------------------------------------------------
// Requests

const VIDEO_FORMATS: [&str; 9] = [".avi", ".wmv", ".mpg", ".mpeg", ".mp4", ".mov", ".mkv", ".flv", ".m4v"];

fn resolve_video(app: &crate::app::App, ctx: &Ctx) -> Result<String, Response> {
    let Some(requested) = ctx.q_nonempty("path") else {
        return Err(text(400, "File path is required"));
    };
    let decoded = jsutil::decode_or_raw(requested);
    let base = app.base_dir();
    let file = jsutil::join(&[&base, &decoded]);
    if !file.starts_with(&base) {
        return Err(text(403, "Forbidden"));
    }
    let ext = jsutil::ext_lower(&file);
    if !VIDEO_FORMATS.contains(&ext.as_str()) {
        return Err(text(400, format!("Video format {} not supported for transcoding. Supported: {}", ext, VIDEO_FORMATS.join(", "))));
    }
    if !Path::new(&file).exists() {
        return Err(text(404, "Video file not found"));
    }
    Ok(file)
}

const STREAM_LIMIT: Duration = Duration::from_secs(4 * 60 * 60);

enum Started {
    Streaming(Response),
    /// ffmpeg failed before writing anything
    Failed(String),
}

/// Start ffmpeg and wait for its first bytes, so a rewrap ffmpeg rejects can still fall back.
async fn start_stream(file: &str, mode: &str, start: f64) -> Started {
    let args = stream_args(file, mode, start);
    let mut child = match command("ffmpeg").args(&args).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn() {
        Ok(c) => c,
        Err(e) => return Started::Failed(format!("Transcoding error: {}", e)),
    };
    let mut stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    // Keep the tail of stderr for the log; reading it also stops ffmpeg from blocking on it
    let err_task = tokio::spawn(async move {
        let mut tail = Vec::new();
        let mut r = stderr;
        let mut buf = [0u8; 4096];
        while let Ok(n) = r.read(&mut buf).await {
            if n == 0 {
                break;
            }
            tail.extend_from_slice(&buf[..n]);
            if tail.len() > 4000 {
                tail.drain(..tail.len() - 2000);
            }
        }
        String::from_utf8_lossy(&tail).into_owned()
    });
    let mut first = vec![0u8; 64 * 1024];
    let n = match stdout.read(&mut first).await {
        Ok(n) => n,
        Err(e) => return Started::Failed(e.to_string()),
    };
    if n == 0 {
        let status = child.wait().await.ok().and_then(|s| s.code());
        let tail = err_task.await.unwrap_or_default();
        crate::error!(" ❌ FFmpeg failed with code {:?}: {}", status, jsutil::js_prefix(&tail[tail.len().saturating_sub(500)..], 500));
        return Started::Failed("Video transcoding failed".into());
    }
    first.truncate(n);
    let deadline = tokio::time::Instant::now() + STREAM_LIMIT;
    // State: (pending first chunk, stdout, child, finished)
    let stream = futures_util::stream::unfold(
        (Some(Bytes::from(first)), stdout, child, false),
        move |(first, mut out, mut child, done)| async move {
            if done {
                return None;
            }
            if let Some(f) = first {
                return Some((Ok::<Bytes, std::io::Error>(f), (None, out, child, false)));
            }
            let mut buf = vec![0u8; 256 * 1024];
            match tokio::time::timeout_at(deadline, out.read(&mut buf)).await {
                Err(_) => {
                    crate::warn!(" ⏱️ FFmpeg timeout reached, killing process");
                    let _ = child.kill().await;
                    None
                }
                Ok(Ok(0)) => {
                    let ok = child.wait().await.map(|s| s.success()).unwrap_or(false);
                    if ok {
                        None
                    } else {
                        // Failed after the headers went out: cut the connection
                        Some((Err(std::io::Error::other("ffmpeg failed")), (None, out, child, true)))
                    }
                }
                Ok(Ok(n)) => {
                    buf.truncate(n);
                    Some((Ok(Bytes::from(buf)), (None, out, child, false)))
                }
                Ok(Err(e)) => Some((Err(e), (None, out, child, true))),
            }
        },
    );
    // Dropping the body (client closed the player or seeked) drops the child: kill_on_drop stops ffmpeg
    Started::Streaming(
        Response::builder()
            .status(200)
            .header(header::CONTENT_TYPE, "video/mp4")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Body::from_stream(stream))
            .unwrap(),
    )
}

async fn stream_video(file: &str, mode: &str, start: f64, start_header: Option<String>) -> Response {
    match start_stream(file, mode, start).await {
        Started::Streaming(mut r) => {
            if let Some(h) = start_header {
                crate::app::set_header(&mut r, "x-video-start", &h);
            }
            r
        }
        Started::Failed(e) if mode != "full" => {
            crate::warn!(" ↩️ Rewrap failed ({}), falling back to a full re-encode", e);
            match start_stream(file, "full", start).await {
                // A re-encode starts exactly where it was asked to
                Started::Streaming(mut r) => {
                    crate::app::set_header(&mut r, "x-video-start", &num_to_string(start));
                    r
                }
                Started::Failed(e) => text(500, e),
            }
        }
        Started::Failed(e) => text(500, e),
    }
}

// GET /video-transcode: whole-file stream for players without Media Source Extensions
pub async fn transcode(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let file = match resolve_video(&app, &ctx) {
        Ok(f) => f,
        Err(r) => return r,
    };
    let mode = plan(&check_codec(&file).await);
    crate::info!(" 🔄 Playback via {}: {}", mode, file);
    stream_video(&file, mode, 0.0, None).await
}

// GET /video-stream?start=: the same stream from a given second, for seeking
pub async fn stream(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let start = ctx.q("start").and_then(parse_float);
    let file = match resolve_video(&app, &ctx) {
        Ok(f) => f,
        Err(r) => return r,
    };
    let mode = plan(&check_codec(&file).await);
    let at = start.filter(|s| s.is_finite() && *s > 0.0).unwrap_or(0.0);
    let real_start = find_start_point(&file, mode, at).await;
    stream_video(&file, mode, at, Some(num_to_string(real_start))).await
}

// GET /api/video-stream-info
pub async fn stream_info(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let file = match resolve_video(&app, &ctx) {
        Ok(f) => f,
        Err(r) => return r,
    };
    let info = check_codec(&file).await;
    let mode = plan(&info);
    let duration = info["format"]["duration"].as_f64().unwrap_or(0.0);
    if info["success"] != json!(true) || duration == 0.0 {
        return json_status(422, &json!({ "error": "Could not read the video duration" }));
    }
    json(&json!({ "duration": jnum(duration), "mode": mode, "mime": stream_mime(&info, mode) }))
}

// GET /api/video-codec-check
pub async fn codec_check(State(app): State<AppRef>, ctx: Ctx) -> crate::app::ApiResult {
    let p = ctx.q_nonempty("path").ok_or_else(|| crate::app::ApiError::bad_request("File path is required"))?;
    let file = crate::browse::resolve_safe_path(&app, p)?;
    Ok(json(&check_codec(&file).await))
}

// ---------------------------------------------------------------------------------------------
// GET /subtitle (SRT converted to WebVTT)

pub fn srt_to_vtt(srt: &str) -> String {
    let re = regex::Regex::new(r"(\d{2}:\d{2}:\d{2}),(\d{3})").unwrap();
    format!("WEBVTT\n\n{}", re.replace_all(srt, "$1.$2"))
}

pub async fn subtitle(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let Some(raw) = ctx.q_nonempty("path") else {
        return text(400, "Subtitle path is required");
    };
    let requested = raw.trim_start_matches(['/', '\\']);
    let base = app.base_dir();
    let file = jsutil::join(&[&base, requested]);
    if !file.starts_with(&base) {
        return text(403, "Forbidden");
    }
    let ext = jsutil::ext_lower(&file);
    if ext != ".srt" && ext != ".vtt" {
        return text(400, "Only SRT and VTT subtitle files are supported");
    }
    if !Path::new(&file).exists() {
        return text(404, "Subtitle file not found");
    }
    match tokio::fs::read(&file).await {
        Ok(data) => {
            let content = String::from_utf8_lossy(&data).into_owned();
            let body = if ext == ".srt" { srt_to_vtt(&content) } else { content };
            Response::builder()
                .status(200)
                .header(header::CONTENT_TYPE, "text/vtt; charset=utf-8")
                .header(header::CACHE_CONTROL, "public, max-age=3600")
                .body(Body::from(body))
                .unwrap()
        }
        Err(e) => text(500, format!("Subtitle error: {}", e)),
    }
}

// ---------------------------------------------------------------------------------------------
// GET /video-thumbnail (cached in <root>/.browser/.thumbs)

const THUMB_EXTS: [&str; 14] = [".mp4", ".avi", ".mov", ".mkv", ".webm", ".mpg", ".mpeg", ".wmv", ".m4v", ".flv", ".3gp", ".ts", ".mts", ".m2ts"];

fn thumb_paths(base: &str, rel: &str, position: f64) -> (std::path::PathBuf, std::path::PathBuf) {
    let dir = Path::new(base).join(".browser").join(".thumbs");
    let _ = std::fs::create_dir_all(&dir);
    let hash = hex::encode(Md5::digest(format!("{}:{}", rel, num_to_string(position)).as_bytes()));
    (dir.join(format!("{}.jpg", hash)), dir.join(format!("{}.meta", hash)))
}

fn cached_thumb(base: &str, rel: &str, position: f64, mtime: i64) -> Option<Vec<u8>> {
    let (img, meta) = thumb_paths(base, rel, position);
    let m: Value = serde_json::from_str(&std::fs::read_to_string(meta).ok()?).ok()?;
    if m["sourceMtime"].as_i64() == Some(mtime) {
        std::fs::read(img).ok()
    } else {
        None
    }
}

fn jpeg(data: Vec<u8>, tag: &str) -> Response {
    Response::builder()
        .status(200)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header("x-thumbnail-cache", tag)
        .header(header::CACHE_CONTROL, "public, max-age=86400")
        .body(Body::from(data))
        .unwrap()
}

pub async fn thumbnail(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let Some(requested) = ctx.q_nonempty("path") else {
        return text(400, "File path is required");
    };
    let position = ctx.q("position").and_then(parse_float).filter(|p| *p != 0.0 && !p.is_nan()).unwrap_or(0.5);
    let decoded = jsutil::decode_or_raw(requested);
    let base = app.base_dir();
    let file = jsutil::join(&[&base, &decoded]);
    if !file.starts_with(&base) {
        return text(403, "Forbidden");
    }
    if !THUMB_EXTS.contains(&jsutil::ext_lower(&file).as_str()) {
        return text(400, "Not a video file");
    }
    let mtime = match std::fs::metadata(&file).and_then(|m| m.modified()) {
        Ok(t) => epoch_ms(t),
        Err(e) => return text(500, format!("Thumbnail generation error: {}", e)),
    };
    if let Some(data) = cached_thumb(&base, &decoded, position, mtime) {
        return jpeg(data, "DISK-HIT");
    }
    let key = format!("{}:{}", file, position);
    let _dedupe = app.video.thumb_inflight.lock(&key).await;
    if let Some(data) = cached_thumb(&base, &decoded, position, mtime) {
        return jpeg(data, "WAIT-HIT");
    }
    let _slot = app.video.thumbs.acquire().await;
    let probe = match run("ffprobe", &["-v", "quiet", "-print_format", "json", "-show_format", &file], Duration::from_secs(60)).await {
        Ok(o) if o.success() => o,
        _ => return text(422, "Video file is corrupted or incomplete"),
    };
    let Ok(info) = serde_json::from_slice::<Value>(&probe.stdout) else {
        return text(422, "Could not parse video metadata");
    };
    let duration = match &info["format"]["duration"] {
        Value::String(s) => parse_float(s).unwrap_or(0.0),
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        _ => 0.0,
    };
    if duration == 0.0 || duration.is_nan() {
        return text(422, "Could not determine video duration - file may be corrupted");
    }
    let seek = (duration * position).floor();
    let seek_s = num_to_string(seek);
    let args = ["-ss", seek_s.as_str(), "-i", file.as_str(), "-vframes", "1", "-vf", "scale=320:-1", "-f", "image2", "-c:v", "mjpeg", "-q:v", "3", "-"];
    let data = match run("ffmpeg", &args, Duration::from_secs(30)).await {
        Ok(o) if o.timed_out => return text(500, "Thumbnail generation error: Thumbnail generation timeout"),
        Ok(o) if o.success() && !o.stdout.is_empty() => o.stdout,
        Ok(o) => return text(500, format!("Thumbnail generation error: FFmpeg exited with code {}", o.status.map(|c| c.to_string()).unwrap_or_else(|| "null".into()))),
        Err(e) => return text(500, format!("Thumbnail generation error: {}", e)),
    };
    let (img, meta) = thumb_paths(&base, &decoded, position);
    let saved = std::fs::write(&img, &data).and_then(|_| {
        std::fs::write(
            &meta,
            serde_json::to_string(&json!({ "sourcePath": decoded, "position": jnum(position), "sourceMtime": mtime, "createdAt": jsutil::now_ms() })).unwrap(),
        )
    });
    if let Err(e) = saved {
        crate::error!(" ❌ Failed to cache thumbnail: {}", e);
    }
    jpeg(data, "MISS")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(codec: &str, pix: &str, profile: &str, audio: Option<(&str, &str)>) -> Value {
        json!({
            "success": true,
            "video": { "codec_name": codec, "pix_fmt": pix, "profile": profile, "level": 41 },
            "audio": audio.map(|(c, p)| vec![json!({"codec_name": c, "profile": p})]).unwrap_or_default(),
        })
    }

    #[test]
    fn transcode_plans() {
        assert_eq!(plan(&info("h264", "yuv420p", "High", Some(("aac", "LC")))), "copy");
        assert_eq!(plan(&info("h264", "yuv420p", "High", None)), "copy");
        assert_eq!(plan(&info("h264", "yuv420p", "Main", Some(("ac3", "")))), "audio");
        assert_eq!(plan(&info("hevc", "yuv420p", "Main", None)), "full");
        assert_eq!(plan(&info("h264", "yuv444p", "High 4:4:4", None)), "full");
        assert_eq!(plan(&json!({"success": false})), "full");
    }

    #[test]
    fn mse_types() {
        let i = info("h264", "yuv420p", "High", Some(("aac", "LC")));
        assert_eq!(stream_mime(&i, "copy"), "video/mp4; codecs=\"avc1.640029, mp4a.40.2\"");
        assert_eq!(stream_mime(&info("h264", "yuv420p", "Main", None), "copy"), "video/mp4; codecs=\"avc1.4d0029\"");
        assert_eq!(stream_mime(&i, "full"), "video/mp4; codecs=\"avc1.640029, mp4a.40.2\"");
    }

    #[test]
    fn ffmpeg_arguments() {
        let a = stream_args("in.mkv", "audio", 12.5);
        let s = a.join(" ");
        assert!(s.starts_with("-fflags +genpts -ss 12.5 -i in.mkv -map 0:v:0 -map 0:a:0? -sn -c:v copy -c:a aac"));
        assert!(s.ends_with("-movflags frag_keyframe+empty_moov+default_base_moof -f mp4 -"));
        assert!(!stream_args("x", "copy", 0.0).contains(&"-ss".to_string()));
    }

    #[test]
    fn srt_conversion() {
        assert_eq!(srt_to_vtt("1\n00:00:20,000 --> 00:00:24,400\nHi"), "WEBVTT\n\n1\n00:00:20.000 --> 00:00:24.400\nHi");
    }
}
