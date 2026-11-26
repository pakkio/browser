//! Library thumbnails, fast: small JPEGs made on the server, cached on disk, and streamed for a
//! whole folder at once.
//!
//! - Level of detail: each source is read once and both levels are cached from that read: a
//!   tiny one (the page shows it first, so every tile fills quickly with little data) and a sharp
//!   one (swapped in next, straight from the cache). JPEGs are decoded at a reduced scale inside
//!   the decoder, PDFs rendered directly at thumbnail size, comics give their first page without
//!   their full page list.
//! - Parallelism: POST /api/thumbnails takes the whole folder in one request (no 6-connections-
//!   per-server browser limit) and works on many files at once, in folder order, sending each
//!   thumbnail as soon as it is ready. The folder's dates come from one directory listing, so
//!   cached thumbnails are answered without touching each file.
//! - Cache: ~/.browser/cache/thumbnails, keyed by path, size and modification time, so a changed
//!   file gets a new thumbnail; the disk cache's size limit and LRU clean-up apply.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use axum::body::Body;
use axum::extract::State;
use axum::http::header;
use axum::response::Response;
use base64::Engine;
use image::{DynamicImage, RgbImage};
use md5::{Digest, Md5};
use serde_json::{json, Value};
use tokio::sync::{mpsc, Semaphore};

use crate::app::{text, ApiError, ApiResult, App, AppRef, Ctx};
use crate::jsutil::{self, epoch_ms};

/// The two levels the page uses; other sizes are accepted within MIN..=MAX.
pub const TINY: u32 = 96;
pub const SHARP: u32 = 400;
const MIN: u32 = 32;
const MAX: u32 = 800;
const QUALITY: u8 = 80;

fn cpu_slots() -> &'static Semaphore {
    static S: OnceLock<Semaphore> = OnceLock::new();
    S.get_or_init(|| {
        // Mostly waiting on the network drive and on pdftoppm, not on the CPU: twice the cores
        let n = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        Semaphore::new((n * 2).clamp(8, 32))
    })
}

/// Video frames at once. Each ffmpeg mostly waits on the drive (on a network drive such as a
/// RaiDrive/MEGA mount, ~0.3 s per file), so overlapping them pays: measured on such a drive,
/// 16 at once took 130 ms per file against 346 ms with 4; 32 was slower again. THUMB_VIDEO_JOBS
/// overrides it.
fn video_slots() -> &'static Semaphore {
    static S: OnceLock<Semaphore> = OnceLock::new();
    S.get_or_init(|| {
        let n = std::env::var("THUMB_VIDEO_JOBS").ok().and_then(|v| v.parse::<usize>().ok()).unwrap_or(16);
        Semaphore::new(n.clamp(1, 64))
    })
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Jpeg,
    Image,
    Pdf,
    Comic,
    Epub,
    Docx,
    Video,
}

fn kind_of(name: &str) -> Option<Kind> {
    Some(match jsutil::ext_lower(name).as_str() {
        ".jpg" | ".jpeg" | ".jfif" | ".pjpeg" | ".pjp" => Kind::Jpeg,
        ".png" | ".gif" | ".webp" | ".bmp" => Kind::Image,
        ".pdf" => Kind::Pdf,
        ".cbz" | ".cbr" => Kind::Comic,
        ".epub" => Kind::Epub,
        ".docx" => Kind::Docx,
        ".mp4" | ".avi" | ".mov" | ".mkv" | ".webm" | ".mpg" | ".mpeg" | ".wmv" | ".m4v" | ".flv" => Kind::Video,
        _ => return None,
    })
}

// ---------------------------------------------------------------------------------------------
// Image work

/// Decode a JPEG at the smallest scale (1/1..1/8, done inside the decoder) that still covers
/// `size` on its long side.
fn decode_jpeg_scaled(data: &[u8], size: u32) -> Option<DynamicImage> {
    let mut d = jpeg_decoder::Decoder::new(data);
    d.read_info().ok()?;
    let info = d.info()?;
    let long = info.width.max(info.height) as u32;
    if long > size {
        let f = size as f64 / long as f64;
        let (w, h) = (((info.width as f64 * f).ceil() as u16).max(1), ((info.height as f64 * f).ceil() as u16).max(1));
        d.scale(w, h).ok()?;
    }
    let pixels = d.decode().ok()?;
    let info = d.info()?;
    let (w, h) = (info.width as u32, info.height as u32);
    let rgb: Vec<u8> = match info.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => pixels,
        jpeg_decoder::PixelFormat::L8 => pixels.iter().flat_map(|&l| [l, l, l]).collect(),
        jpeg_decoder::PixelFormat::CMYK32 => pixels
            .as_chunks::<4>().0.iter()
            .flat_map(|p| {
                let k = p[3] as u32;
                [(p[0] as u32 * k / 255) as u8, (p[1] as u32 * k / 255) as u8, (p[2] as u32 * k / 255) as u8]
            })
            .collect(),
        jpeg_decoder::PixelFormat::L16 => return image::load_from_memory(data).ok(),
    };
    RgbImage::from_raw(w, h, rgb).map(DynamicImage::ImageRgb8)
}

/// Any supported image, decoded no larger than needed for `size`.
fn decode(data: &[u8], size: u32) -> Option<DynamicImage> {
    if data.starts_with(&[0xff, 0xd8]) {
        if let Some(img) = decode_jpeg_scaled(data, size) {
            return Some(img);
        }
    }
    image::load_from_memory(data).ok()
}

fn encode(img: &DynamicImage, size: u32) -> Option<Vec<u8>> {
    let small = if img.width().max(img.height()) > size { img.thumbnail(size, size) } else { img.clone() };
    let rgb = small.to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, QUALITY).encode_image(&rgb).ok()?;
    Some(out)
}

// ---------------------------------------------------------------------------------------------
// Cache

fn cache_dir(app: &App) -> PathBuf {
    let d = app.cache.dir.join("thumbnails");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn cache_base(app: &App, path: &str, size: u32, mtime: i64) -> PathBuf {
    let key = hex::encode(Md5::digest(format!("thumb-v1:{}:{}:{}", path, size, mtime).as_bytes()));
    cache_dir(app).join(key)
}

/// "No thumbnail" is remembered for a day, so a passing failure (a network hiccup, tools not
/// installed yet) is retried, but a folder full of cover-less files is not re-read on every visit.
const MISSING_TTL: Duration = Duration::from_secs(24 * 60 * 60);

type Thumb = Result<(Vec<u8>, &'static str), String>;

/// A cached answer: a JPEG, a text card (SVG) or "no thumbnail".
fn cached(app: &App, path: &str, size: u32, mtime: i64) -> Option<Thumb> {
    let base = cache_base(app, path, size, mtime);
    if let Ok(d) = std::fs::read(base.with_extension("jpg")) {
        return Some(Ok((d, "image/jpeg")));
    }
    if let Ok(d) = std::fs::read(base.with_extension("svg")) {
        return Some(Ok((d, "image/svg+xml")));
    }
    let none = base.with_extension("none");
    let fresh = std::fs::metadata(&none).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).map(|age| age < MISSING_TTL);
    match fresh {
        Some(true) => Some(Err(std::fs::read_to_string(none).unwrap_or_else(|_| "No thumbnail".into()))),
        _ => None,
    }
}

fn store(app: &App, path: &str, size: u32, mtime: i64, data: &[u8]) {
    let _ = std::fs::write(cache_base(app, path, size, mtime).with_extension("jpg"), data);
}

fn store_svg(app: &App, path: &str, size: u32, mtime: i64, data: &[u8]) {
    let _ = std::fs::write(cache_base(app, path, size, mtime).with_extension("svg"), data);
}

fn store_missing(app: &App, path: &str, sizes: &[u32], mtime: i64, why: &str) {
    for &s in sizes {
        let _ = std::fs::write(cache_base(app, path, s, mtime).with_extension("none"), why);
    }
}

// ---------------------------------------------------------------------------------------------
// Sources

/// The image a thumbnail is made from (a comic's first page, an EPUB cover, a video frame...).
async fn source_image(app: &App, kind: Kind, path: &str) -> Result<Vec<u8>, String> {
    match kind {
        Kind::Image => tokio::fs::read(path).await.map_err(|e| e.to_string()),
        Kind::Comic => {
            // A page list built earlier (the reader was opened) knows the real first page
            let key = app.cache.generate_key(path, "comic-list", "");
            if let Some(Value::Array(list)) = app.cache.get("comic-lists", &key, Some(path)) {
                if let Some(first) = list.first().filter(|f| f.get("pdfPage").is_none()) {
                    let entry = first.as_str().or_else(|| first["file"].as_str()).unwrap_or("").to_string();
                    let p = path.to_string();
                    let data = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
                        if jsutil::ext_lower(&p) == ".cbr" {
                            if let Ok(Some(d)) = crate::comics::rar_extract_lib(&p, &entry) {
                                return Ok(d);
                            }
                        }
                        let mut z = crate::archives::open_zip(&p).map_err(|e| e.to_string())?;
                        let mut f = z.by_name(&entry).map_err(|e| e.to_string())?;
                        let mut buf = Vec::new();
                        std::io::Read::read_to_end(&mut f, &mut buf).map_err(|e| e.to_string())?;
                        Ok(buf)
                    })
                    .await
                    .map_err(|e| e.to_string())?;
                    if let Ok(d) = data {
                        return Ok(d);
                    }
                }
            }
            let p = path.to_string();
            match tokio::task::spawn_blocking(move || crate::comics::cover_fast(&p)).await.map_err(|e| e.to_string())?? {
                crate::comics::Cover::Image(d) => Ok(d),
                crate::comics::Cover::Pdf(temp) => {
                    let page = render_pdf(&temp.to_string_lossy(), SHARP).await;
                    let _ = std::fs::remove_file(temp);
                    page
                }
            }
        }
        Kind::Epub => {
            let p = path.to_string();
            match tokio::task::spawn_blocking(move || crate::documents::read_cover(&p, None)).await.map_err(|e| e.to_string())?? {
                crate::documents::CoverResult::Found(data, _) => Ok(data),
                _ => Err("No cover".into()),
            }
        }
        Kind::Video => video_frame(path).await,
        Kind::Jpeg => tokio::fs::read(path).await.map_err(|e| e.to_string()),
        Kind::Pdf => render_pdf(path, SHARP).await,
        Kind::Docx => Err("not an image source".into()),
    }
}

/// One frame from the middle of a video, already small.
/// The caller already holds a video slot.
async fn video_frame(path: &str) -> Result<Vec<u8>, String> {
    let probe = crate::util::run("ffprobe", &["-v", "quiet", "-print_format", "json", "-show_format", path], Duration::from_secs(60))
        .await
        .map_err(|e| e.to_string())?;
    let info: Value = serde_json::from_slice(&probe.stdout).map_err(|_| "Could not read the video")?;
    let duration = info["format"]["duration"].as_str().and_then(jsutil::parse_float).unwrap_or(0.0);
    let seek = jsutil::num_to_string((duration * 0.5).floor());
    let scale = format!("scale={}:-2", SHARP);
    let args = ["-ss", seek.as_str(), "-i", path, "-vframes", "1", "-vf", scale.as_str(), "-f", "image2", "-c:v", "mjpeg", "-q:v", "4", "-"];
    let out = crate::util::run("ffmpeg", &args, Duration::from_secs(30)).await.map_err(|e| e.to_string())?;
    if out.success() && !out.stdout.is_empty() {
        Ok(out.stdout)
    } else {
        Err("ffmpeg could not read a frame".into())
    }
}

/// First page of a PDF as a JPEG no larger than `size`, straight from Poppler (no temp file).
async fn render_pdf(path: &str, size: u32) -> Result<Vec<u8>, String> {
    let s = size.to_string();
    let q = format!("quality={}", QUALITY);
    let out = crate::util::run("pdftoppm", &["-jpeg", "-jpegopt", &q, "-f", "1", "-l", "1", "-scale-to", &s, "-singlefile", path], Duration::from_secs(60)).await;
    match out {
        Ok(o) if o.success() && !o.stdout.is_empty() => Ok(o.stdout),
        _ => crate::media::pdf::render_page(path, 1, 72, -1, -1).await,
    }
}

// ---------------------------------------------------------------------------------------------
// One thumbnail

/// A thumbnail of `path` no larger than `size` on its long side: (bytes, content type).
/// `mtime` is the file's modification time when the caller already has it (from a directory
/// listing), which spares a round trip to a network drive.
pub async fn make(app: &App, path: &str, size: u32, mtime: Option<i64>) -> Result<(Vec<u8>, &'static str), String> {
    let size = size.clamp(MIN, MAX);
    let kind = kind_of(path).ok_or("No thumbnail for this type")?;
    let mtime = match mtime {
        Some(m) => m,
        None => std::fs::metadata(path).and_then(|m| m.modified()).map(epoch_ms).map_err(|e| e.to_string())?,
    };
    if let Some(hit) = cached(app, path, size, mtime) {
        return hit;
    }
    let levels: Vec<u32> = if size == TINY || size == SHARP { vec![TINY, SHARP] } else { vec![size] };
    let result = generate(app, kind, path, size, mtime, &levels).await;
    if let Err(why) = &result {
        store_missing(app, path, &levels, mtime, why);
    }
    result
}

async fn generate(app: &App, kind: Kind, path: &str, size: u32, mtime: i64, levels: &[u32]) -> Thumb {
    if kind == Kind::Docx {
        let p = path.to_string();
        return match tokio::task::spawn_blocking(move || crate::documents::docx_preview_blocking(&p)).await.map_err(|e| e.to_string())? {
            crate::documents::Docx::Thumb(data, _) => {
                let out = tokio::task::spawn_blocking(move || decode(&data, size).and_then(|i| encode(&i, size))).await.map_err(|e| e.to_string())?;
                let out = out.ok_or("Unreadable thumbnail")?;
                store(app, path, size, mtime, &out);
                Ok((out, "image/jpeg"))
            }
            crate::documents::Docx::Text(t) => {
                let svg = crate::documents::docx_text_svg(&t).into_bytes();
                for &l in levels {
                    store_svg(app, path, l, mtime, &svg);
                }
                Ok((svg, "image/svg+xml"))
            }
            crate::documents::Docx::None => Err("No thumbnail".into()),
        };
    }

    let slots = if kind == Kind::Video { video_slots() } else { cpu_slots() };
    let _slot = slots.acquire().await.map_err(|e| e.to_string())?;
    // Another request may have made it while this one waited
    if let Some(hit) = cached(app, path, size, mtime) {
        return hit;
    }
    // Read the source once and keep both levels
    let data = source_image(app, kind, path).await?;
    let levels = levels.to_vec();
    let biggest = *levels.iter().max().unwrap();
    let encoded = tokio::task::spawn_blocking(move || -> Option<Vec<(u32, Vec<u8>)>> {
        let img = decode(&data, biggest)?;
        levels.into_iter().map(|l| encode(&img, l).map(|e| (l, e))).collect()
    })
    .await
    .map_err(|e| e.to_string())?
    .ok_or("Unreadable image")?;
    let mut wanted = None;
    for (l, e) in encoded {
        store(app, path, l, mtime, &e);
        if l == size {
            wanted = Some(e);
        }
    }
    wanted.map(|w| (w, "image/jpeg")).ok_or_else(|| "No thumbnail".into())
}

fn size_param(v: Option<&Value>) -> u32 {
    v.and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))).unwrap_or(SHARP as u64) as u32
}

// GET /api/thumbnail?path=&size=
pub async fn one(State(app): State<AppRef>, ctx: Ctx) -> ApiResult {
    let p = ctx.q_nonempty("path").ok_or_else(|| ApiError::bad_request("File path is required"))?;
    let full = crate::browse::resolve_safe_path(&app, p)?;
    let size = size_param(ctx.q("size").map(|s| Value::String(s.into())).as_ref());
    match make(&app, &full, size, None).await {
        Ok((data, mime)) => Ok(Response::builder()
            .status(200)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CACHE_CONTROL, "private, max-age=86400")
            .body(Body::from(data))
            .unwrap()),
        Err(e) => Ok(text(404, e)),
    }
}

// POST /api/thumbnails {dir, files: [names in display order], size}
// Answers application/x-ndjson: one line {"name", "type", "data" (base64)} or {"name", "error"}
// per file, as each one is ready.
pub async fn batch(State(app): State<AppRef>, ctx: Ctx) -> ApiResult {
    let dir_rel = ctx.b_str("dir").unwrap_or("").to_string();
    let dir = crate::browse::resolve_safe_path(&app, &dir_rel)?;
    let names: Vec<String> = ctx
        .b("files")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::bad_request("files is required"))?
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .take(5000)
        .collect();
    let size = size_param(ctx.b("size"));
    // All modification times from one listing of the folder (on Windows the listing carries them)
    let d = dir.clone();
    let mtimes: std::collections::HashMap<String, i64> = tokio::task::spawn_blocking(move || {
        std::fs::read_dir(&d)
            .map(|rd| {
                rd.flatten()
                    .filter_map(|e| Some((e.file_name().to_string_lossy().into_owned(), epoch_ms(e.metadata().ok()?.modified().ok()?))))
                    .collect()
            })
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default();
    let mtimes = std::sync::Arc::new(mtimes);
    let (tx, mut rx) = mpsc::channel::<String>(64);
    for name in names {
        let (app, tx, dir, mtimes) = (app.clone(), tx.clone(), dir.clone(), mtimes.clone());
        tokio::spawn(async move {
            // Plain file names only: nothing outside the folder
            let line = if name.is_empty() || name.contains(['/', '\\']) || name == ".." {
                json!({ "name": name, "error": "Invalid name" })
            } else if tx.is_closed() {
                return; // the page moved on
            } else {
                let full = Path::new(&dir).join(&name).to_string_lossy().into_owned();
                // One stuck file must not hold up the rest of the folder
                let made = tokio::time::timeout(Duration::from_secs(120), make(&app, &full, size, mtimes.get(&name).copied()))
                    .await
                    .unwrap_or_else(|_| Err("Timed out".into()));
                match made {
                    Ok((data, mime)) => json!({ "name": name, "type": mime, "data": base64::engine::general_purpose::STANDARD.encode(data) }),
                    Err(e) => json!({ "name": name, "error": e }),
                }
            };
            let _ = tx.send(format!("{}\n", line)).await;
        });
    }
    drop(tx);
    let stream = futures_util::stream::poll_fn(move |cx| rx.poll_recv(cx).map(|o| o.map(Ok::<_, std::io::Error>)));
    Ok(Response::builder()
        .status(200)
        .header(header::CONTENT_TYPE, "application/x-ndjson")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from_stream(stream))
        .unwrap())
}

// ---------------------------------------------------------------------------------------------
// Archive entry thumbnails (PDFs and images inside .zip / .cbz / .rar / .cbr)

enum ExtractedEntry {
    Pdf(PathBuf),
    Image(Vec<u8>),
}

fn extract_zip_entry<R: std::io::Read + std::io::Seek>(z: &mut zip::ZipArchive<R>, entry: &str, kind: Kind) -> Result<ExtractedEntry, String> {
    let mut f = z.by_name(entry).map_err(|_| format!("File not found in archive: {}", entry))?;
    match kind {
        Kind::Pdf => {
            let out = crate::util::temp_dir("filebrowser-comics").join(crate::util::unique_name(&jsutil::basename(entry)));
            let res = (|| -> std::io::Result<()> {
                let mut w = std::fs::File::create(&out)?;
                std::io::copy(&mut f, &mut w)?;
                Ok(())
            })();
            match res {
                Ok(()) => Ok(ExtractedEntry::Pdf(out)),
                Err(e) => {
                    let _ = std::fs::remove_file(&out);
                    Err(e.to_string())
                }
            }
        }
        Kind::Jpeg | Kind::Image => {
            let mut buf = Vec::new();
            std::io::Read::read_to_end(&mut f, &mut buf).map_err(|e| e.to_string())?;
            Ok(ExtractedEntry::Image(buf))
        }
        _ => Err("Unsupported".into()),
    }
}

fn extract_rar_entry(archive: &str, entry: &str, kind: Kind) -> Result<ExtractedEntry, String> {
    let data = crate::comics::rar_extract_lib(archive, entry)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Could not read RAR entry".to_string())?;
    match kind {
        Kind::Pdf => {
            let temp = crate::util::temp_dir("filebrowser-comics").join(crate::util::unique_name(&jsutil::basename(entry)));
            std::fs::write(&temp, data).map_err(|e| e.to_string())?;
            Ok(ExtractedEntry::Pdf(temp))
        }
        Kind::Jpeg | Kind::Image => Ok(ExtractedEntry::Image(data)),
        _ => Err("Unsupported".into()),
    }
}

/// Render an already-extracted archive entry into both LOD levels, cache them, and return `size`.
async fn render_extracted_entry(
    app: &App,
    cache_key: &str,
    extracted: ExtractedEntry,
    size: u32,
    mtime: i64,
    levels: &[u32],
) -> Thumb {
    let source_res: Result<Vec<u8>, String> = match extracted {
        ExtractedEntry::Pdf(path) => {
            let rendered = render_pdf(&path.to_string_lossy(), SHARP).await;
            let _ = std::fs::remove_file(&path);
            rendered
        }
        ExtractedEntry::Image(bytes) => Ok(bytes),
    };

    let data = match source_res {
        Ok(d) => d,
        Err(why) => {
            store_missing(app, cache_key, levels, mtime, &why);
            return Err(why);
        }
    };

    let levels_vec = levels.to_vec();
    let biggest = *levels_vec.iter().max().unwrap();
    let encoded = tokio::task::spawn_blocking(move || -> Option<Vec<(u32, Vec<u8>)>> {
        let img = decode(&data, biggest)?;
        levels_vec.into_iter().map(|l| encode(&img, l).map(|e| (l, e))).collect()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(encoded) = encoded else {
        let why = "Unreadable image".to_string();
        store_missing(app, cache_key, levels, mtime, &why);
        return Err(why);
    };

    let mut wanted = None;
    for (l, e) in encoded {
        store(app, cache_key, l, mtime, &e);
        if l == size {
            wanted = Some(e);
        }
    }
    wanted.map(|w| (w, "image/jpeg")).ok_or_else(|| "No thumbnail".into())
}

// POST /api/archive-thumbnails {archive, subPath, files: [names], size}
// Streams application/x-ndjson lines identical to /api/thumbnails.
//
// Cached entries answer immediately without touching the archive. Uncached entries are extracted
// sequentially from a single open handle (opening a large ZIP on a network/RaiDrive mount 32 times
// in parallel stalls on seek contention) and handed to a small pool of renderers.
pub async fn archive_batch(State(app): State<AppRef>, ctx: Ctx) -> ApiResult {
    let archive_rel = ctx.b_str("archive").filter(|s| !s.is_empty()).ok_or_else(|| ApiError::bad_request("archive is required"))?;
    let archive_full = crate::browse::resolve_safe_path(&app, archive_rel)?;
    let sub_path = ctx.b_str("subPath").unwrap_or("").trim_matches('/').to_string();
    let names: Vec<String> = ctx
        .b("files")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::bad_request("files is required"))?
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .take(5000)
        .collect();
    let size = size_param(ctx.b("size")).clamp(MIN, MAX);
    let mtime = std::fs::metadata(&archive_full)
        .and_then(|m| m.modified())
        .map(epoch_ms)
        .map_err(|_| ApiError::not_found("Archive not found"))?;
    let levels: Vec<u32> = if size == TINY || size == SHARP { vec![TINY, SHARP] } else { vec![size] };

    let (tx, mut rx) = mpsc::channel::<String>(64);
    let app_bg = app.clone();
    tokio::spawn(async move {
        // 1. Answer everything already in the disk cache first, in display order.
        let mut todo: Vec<(String, String, Kind)> = Vec::new();
        for name in names {
            if tx.is_closed() {
                return;
            }
            if name.is_empty() || name.contains(['/', '\\']) || name == ".." {
                let _ = tx.send(format!("{}\n", json!({ "name": name, "error": "Invalid name" }))).await;
                continue;
            }
            let entry = if sub_path.is_empty() { name.clone() } else { format!("{}/{}", sub_path, name) };
            let Some(kind) = kind_of(&entry).filter(|k| matches!(k, Kind::Jpeg | Kind::Image | Kind::Pdf)) else {
                let _ = tx.send(format!("{}\n", json!({ "name": name, "error": "No thumbnail for this type" }))).await;
                continue;
            };
            let cache_key = format!("{}::{}", archive_full, entry);
            if let Some(hit) = cached(&app_bg, &cache_key, size, mtime) {
                let line = match hit {
                    Ok((data, mime)) => json!({ "name": name, "type": mime, "data": base64::engine::general_purpose::STANDARD.encode(data) }),
                    Err(e) => json!({ "name": name, "error": e }),
                };
                if tx.send(format!("{}\n", line)).await.is_err() {
                    return;
                }
                continue;
            }
            todo.push((name, entry, kind));
        }

        if todo.is_empty() || tx.is_closed() {
            return;
        }

        // 2. Extract remaining entries sequentially from one open archive handle, feeding a
        // bounded queue (max 4 in-flight renders) so disk/network I/O overlaps with pdftoppm
        // without hammering a remote/RaiDrive mount with dozens of competing readers.
        let (work_tx, mut work_rx) = mpsc::channel::<(String, String, Result<ExtractedEntry, String>)>(4);
        let ext = jsutil::ext_lower(&archive_full);
        let is_rar = ext == ".rar" || ext == ".cbr";
        let archive_reader = archive_full.clone();
        let tx_cancel = tx.clone();

        tokio::task::spawn_blocking(move || {
            if is_rar {
                for (name, entry, kind) in todo {
                    if tx_cancel.is_closed() {
                        break;
                    }
                    let res = extract_rar_entry(&archive_reader, &entry, kind);
                    if work_tx.blocking_send((name, entry, res)).is_err() {
                        break;
                    }
                }
                return;
            }
            let mut z = match crate::archives::open_zip(&archive_reader) {
                Ok(z) => z,
                Err(e) => {
                    let msg = e.to_string();
                    for (name, entry, _) in todo {
                        if tx_cancel.is_closed() || work_tx.blocking_send((name, entry, Err(msg.clone()))).is_err() {
                            break;
                        }
                    }
                    return;
                }
            };
            for (name, entry, kind) in todo {
                if tx_cancel.is_closed() {
                    break;
                }
                let res = extract_zip_entry(&mut z, &entry, kind);
                if work_tx.blocking_send((name, entry, res)).is_err() {
                    break;
                }
            }
        });

        let render_slots = std::sync::Arc::new(Semaphore::new(4));
        while let Some((name, entry, extracted)) = work_rx.recv().await {
            if tx.is_closed() {
                if let Ok(ExtractedEntry::Pdf(p)) = extracted {
                    let _ = std::fs::remove_file(p);
                }
                continue;
            }
            let Ok(permit) = render_slots.clone().acquire_owned().await else { break };
            let (app_r, tx_r, archive_r, levels_r) = (app_bg.clone(), tx.clone(), archive_full.clone(), levels.clone());
            tokio::spawn(async move {
                let _permit = permit;
                let cache_key = format!("{}::{}", archive_r, entry);
                let line = match extracted {
                    Ok(item) => {
                        let made = tokio::time::timeout(
                            Duration::from_secs(60),
                            render_extracted_entry(&app_r, &cache_key, item, size, mtime, &levels_r),
                        )
                        .await
                        .unwrap_or_else(|_| Err("Timed out".into()));
                        match made {
                            Ok((data, mime)) => json!({ "name": name, "type": mime, "data": base64::engine::general_purpose::STANDARD.encode(data) }),
                            Err(e) => json!({ "name": name, "error": e }),
                        }
                    }
                    Err(why) => {
                        store_missing(&app_r, &cache_key, &levels_r, mtime, &why);
                        json!({ "name": name, "error": why })
                    }
                };
                let _ = tx_r.send(format!("{}\n", line)).await;
            });
        }
    });

    let stream = futures_util::stream::poll_fn(move |cx| rx.poll_recv(cx).map(|o| o.map(Ok::<_, std::io::Error>)));
    Ok(Response::builder()
        .status(200)
        .header(header::CONTENT_TYPE, "application/x-ndjson")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from_stream(stream))
        .unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jpeg(w: u32, h: u32) -> Vec<u8> {
        let img = RgbImage::from_fn(w, h, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, 128]));
        let mut out = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 90).encode_image(&img).unwrap();
        out
    }

    #[test]
    fn jpeg_is_decoded_at_a_reduced_scale() {
        let img = decode_jpeg_scaled(&jpeg(1600, 2400), TINY).unwrap();
        // 1/8 scale: 200x300, the smallest that still covers 96 px
        assert_eq!((img.width(), img.height()), (200, 300));
        let small = encode(&img, TINY).unwrap();
        let back = image::load_from_memory(&small).unwrap();
        assert_eq!(back.width().max(back.height()), TINY);
    }

    #[test]
    fn small_images_are_not_enlarged() {
        let img = decode(&jpeg(50, 40), SHARP).unwrap();
        let back = image::load_from_memory(&encode(&img, SHARP).unwrap()).unwrap();
        assert_eq!((back.width(), back.height()), (50, 40));
    }

    #[test]
    fn kinds() {
        assert_eq!(kind_of("a.JPG"), Some(Kind::Jpeg));
        assert_eq!(kind_of("a.cbr"), Some(Kind::Comic));
        assert_eq!(kind_of("a.txt"), None);
    }
}
