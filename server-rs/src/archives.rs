//! Archive browsing: listing a folder level of a ZIP / RAR / TAR (.tar, .tgz, .tar.gz, .oar)
//! and extracting one file from it (lib/archive-handlers.js).

use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom, Write};

use axum::extract::State;
use axum::http::header;
use axum::response::Response;
use serde_json::{json, Value};

use crate::app::{inline_disposition, text, AppRef, Ctx};
use crate::jsutil::{self, iso};
use crate::util::{blocking_stream, hex_dump, KeyedLocks};

#[derive(Default)]
pub struct ArchiveState {
    zip_index: KeyedLocks,
}

/// One entry of an archive: full path inside it, kind, size and date.
#[derive(Clone)]
pub struct Entry {
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub modified: Option<String>,
}

impl Entry {
    fn to_json(&self) -> Value {
        json!({ "path": self.path, "isDirectory": self.is_dir, "size": self.size, "modified": self.modified })
    }
    fn from_json(v: &Value) -> Option<Entry> {
        Some(Entry {
            path: v.get("path")?.as_str()?.to_string(),
            is_dir: v.get("isDirectory").and_then(Value::as_bool).unwrap_or(false),
            size: v.get("size").and_then(Value::as_u64),
            modified: v.get("modified").and_then(Value::as_str).map(String::from),
        })
    }
}

/// A ZIP date (local time, like yauzl's getLastModDate) as an ISO string.
pub fn zip_date(dt: Option<zip::DateTime>) -> Option<String> {
    use chrono::TimeZone;
    let d = dt?;
    let local = chrono::Local
        .with_ymd_and_hms(d.year() as i32, d.month().max(1) as u32, d.day().max(1) as u32, d.hour() as u32, d.minute() as u32, d.second() as u32)
        .earliest()?;
    Some(iso(local.into()))
}

/// A RAR (DOS) timestamp as an ISO string.
fn dos_date(t: u32) -> Option<String> {
    use chrono::TimeZone;
    let (date, time) = ((t >> 16) as u16, (t & 0xffff) as u16);
    let local = chrono::Local
        .with_ymd_and_hms(
            1980 + (date >> 9) as i32,
            ((date >> 5) & 0xf).max(1) as u32,
            (date & 0x1f).max(1) as u32,
            (time >> 11) as u32,
            ((time >> 5) & 0x3f) as u32,
            ((time & 0x1f) * 2) as u32,
        )
        .earliest()?;
    Some(iso(local.into()))
}

pub fn open_zip(path: &str) -> zip::result::ZipResult<zip::ZipArchive<BufReader<File>>> {
    let f = File::open(path)?;
    zip::ZipArchive::new(BufReader::new(f))
}

fn zip_all_entries(path: &str) -> Result<Vec<Entry>, String> {
    let mut z = open_zip(path).map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(z.len());
    for i in 0..z.len() {
        let f = z.by_index_raw(i).map_err(|e| e.to_string())?;
        let raw = f.name().replace('\\', "/");
        let is_dir = raw.ends_with('/');
        out.push(Entry {
            path: if is_dir { raw[..raw.len() - 1].to_string() } else { raw },
            is_dir,
            size: if is_dir { None } else { Some(f.size()) },
            modified: zip_date(f.last_modified()),
        });
    }
    Ok(out)
}

pub fn rar_all_entries(path: &str) -> Result<Vec<Entry>, String> {
    let archive = unrar::Archive::new(path).open_for_listing().map_err(|e| format!("File is not RAR archive ({})", e))?;
    let mut out = Vec::new();
    for header in archive {
        let h = header.map_err(|e| e.to_string())?;
        out.push(Entry {
            path: h.filename.to_string_lossy().replace('\\', "/"),
            is_dir: h.is_directory(),
            size: if h.is_directory() { None } else { Some(h.unpacked_size) },
            modified: dos_date(h.file_time),
        });
    }
    Ok(out)
}

/// The items directly inside `sub_path` (folders first, then by name).
pub fn build_sub_path_items(all: &[Entry], sub_path: &str) -> Vec<Value> {
    let clean = sub_path.replace('\\', "/");
    let clean = clean.trim_matches('/');
    let mut items: indexmap_lite::Map = indexmap_lite::Map::default();
    for item in all {
        let full = item.path.replace('\\', "/");
        let full = full.trim_start_matches('/');
        if full.is_empty() {
            continue;
        }
        if !clean.is_empty() && !full.starts_with(&format!("{}/", clean)) && full != clean {
            continue;
        }
        let mut rel = if clean.is_empty() { full } else { full.get(clean.len() + 1..).unwrap_or("") };
        if let Some(r) = rel.strip_prefix('/') {
            rel = r;
        }
        if rel.is_empty() {
            continue;
        }
        if let Some((dir, _)) = rel.split_once('/') {
            if !dir.is_empty() && !items.contains(dir) {
                items.insert(dir.to_string(), json!({ "name": dir, "isDirectory": true, "size": null, "modified": null }));
            }
            continue;
        }
        items.insert(
            rel.to_string(),
            json!({ "name": rel, "isDirectory": item.is_dir, "size": if item.is_dir { None } else { item.size }, "modified": item.modified }),
        );
    }
    let mut v = items.into_values();
    sort_items(&mut v);
    v
}

/// Folders first, then names in locale order.
pub fn sort_items(v: &mut [Value]) {
    v.sort_by(|a, b| {
        let (ad, bd) = (a["isDirectory"].as_bool().unwrap_or(false), b["isDirectory"].as_bool().unwrap_or(false));
        bd.cmp(&ad).then_with(|| jsutil::locale_cmp(a["name"].as_str().unwrap_or(""), b["name"].as_str().unwrap_or("")))
    });
}

/// Small insertion-ordered map (keeps the first position of a key, like a JS Map).
mod indexmap_lite {
    use serde_json::Value;
    #[derive(Default)]
    pub struct Map {
        keys: Vec<String>,
        values: std::collections::HashMap<String, Value>,
    }
    impl Map {
        pub fn contains(&self, k: &str) -> bool {
            self.values.contains_key(k)
        }
        pub fn insert(&mut self, k: String, v: Value) {
            if !self.values.contains_key(&k) {
                self.keys.push(k.clone());
            }
            self.values.insert(k, v);
        }
        pub fn into_values(mut self) -> Vec<Value> {
            self.keys.iter().filter_map(|k| self.values.remove(k)).collect()
        }
    }
}

async fn cached_entries(app: &AppRef, file_path: &str, op: &str, list: fn(&str) -> Result<Vec<Entry>, String>) -> Result<Vec<Entry>, String> {
    let key = app.cache.generate_key(file_path, op, "");
    if let Some(Value::Array(a)) = app.cache.get("archive-contents", &key, Some(file_path)) {
        return Ok(a.iter().filter_map(Entry::from_json).collect());
    }
    let _guard = app.archives.zip_index.lock(&key).await;
    if let Some(Value::Array(a)) = app.cache.get("archive-contents", &key, Some(file_path)) {
        return Ok(a.iter().filter_map(Entry::from_json).collect());
    }
    let fp = file_path.to_string();
    let entries = tokio::task::spawn_blocking(move || list(&fp)).await.map_err(|e| e.to_string())??;
    let arr = Value::Array(entries.iter().map(Entry::to_json).collect());
    app.cache.set("archive-contents", &key, &arr, Some(file_path));
    Ok(entries)
}

/// The listing of a ZIP folder level, forgiving about wrapper folders the client may add or omit.
async fn zip_contents(app: &AppRef, file_path: &str, sub_path: &str, op: &str, list: fn(&str) -> Result<Vec<Entry>, String>, index_op: &str) -> Result<Vec<Value>, String> {
    let sub_key = app.cache.generate_key(file_path, op, sub_path);
    if let Some(Value::Array(a)) = app.cache.get("archive-contents", &sub_key, Some(file_path)) {
        if !a.is_empty() {
            return Ok(a);
        }
    }
    let all = cached_entries(app, file_path, index_op, list).await?;
    let mut result = build_sub_path_items(&all, sub_path);
    if result.is_empty() && !sub_path.is_empty() {
        let clean = sub_path.replace('\\', "/");
        let parts: Vec<&str> = clean.trim_matches('/').split('/').filter(|s| !s.is_empty()).collect();
        // 1) Strip leading folders: "Extra/Real/Sub" -> "Real/Sub"
        let mut i = 1;
        while i < parts.len() && result.is_empty() {
            result = build_sub_path_items(&all, &parts[i..].join("/"));
            i += 1;
        }
        // 2) Find the folder anywhere inside the archive (a wrapper folder was omitted)
        let mut i = 0;
        while i < parts.len() && result.is_empty() {
            let needle = format!("/{}/", parts[i..].join("/"));
            if let Some(hit) = all.iter().find(|e| format!("/{}/", e.path.replace('\\', "/")).contains(&needle)) {
                let norm = hit.path.replace('\\', "/");
                let idx = format!("/{}/", norm).find(&needle).unwrap();
                let end = (idx + needle.len()).saturating_sub(2).min(norm.len());
                result = build_sub_path_items(&all, &norm[..end]);
            }
            i += 1;
        }
    }
    if !result.is_empty() {
        app.cache.set("archive-contents", &sub_key, &Value::Array(result.clone()), Some(file_path));
    }
    Ok(result)
}

fn is_tar_name(p: &str) -> bool {
    let ext = jsutil::ext_lower(p);
    matches!(ext.as_str(), ".tar" | ".tgz" | ".oar") || p.ends_with(".tar") || p.ends_with(".tgz") || p.ends_with(".tar.gz") || p.ends_with(".oar")
}

/// A tar reader that transparently un-gzips (node-tar detects gzip the same way).
fn open_tar(path: &str) -> std::io::Result<tar::Archive<Box<dyn Read>>> {
    let mut f = File::open(path)?;
    let mut magic = [0u8; 2];
    let n = f.read(&mut magic)?;
    f.seek(SeekFrom::Start(0))?;
    let reader: Box<dyn Read> = if n == 2 && magic == [0x1f, 0x8b] {
        Box::new(flate2::read::MultiGzDecoder::new(BufReader::new(f)))
    } else {
        Box::new(BufReader::new(f))
    };
    Ok(tar::Archive::new(reader))
}

/// Items collected for one folder level of a tar archive.
#[derive(Default)]
struct Level {
    contents: Vec<Value>,
    dirs: Vec<String>,
}

impl Level {
    fn add(&mut self, sub_path: &str, full: &str, is_dir: bool, size: Option<u64>, modified: Option<String>) {
        if !sub_path.is_empty() && !full.starts_with(&format!("{}/", sub_path)) && full != sub_path {
            return;
        }
        let mut rel = if sub_path.is_empty() { full } else { full.get(sub_path.len() + 1..).unwrap_or("") };
        if let Some(r) = rel.strip_prefix('/') {
            rel = r;
        }
        if rel.is_empty() {
            return;
        }
        if let Some((d, _)) = rel.split_once('/') {
            if !self.dirs.iter().any(|x| x == d) {
                self.dirs.push(d.to_string());
            }
        } else {
            self.contents.push(json!({ "name": rel, "isDirectory": is_dir, "size": size, "modified": modified }));
        }
    }
}

fn tar_level(file_path: &str, sub_path: &str) -> Result<Vec<Value>, String> {
    let mut level = Level::default();
    let read = (|| -> std::io::Result<()> {
        let mut archive = open_tar(file_path)?;
        for entry in archive.entries()? {
            let entry = entry?;
            let h = entry.header();
            let full = String::from_utf8_lossy(&entry.path_bytes()).into_owned();
            let is_dir = h.entry_type().is_dir();
            let size = h.size().ok().filter(|&s| s > 0);
            let modified = h.mtime().ok().map(|s| iso(std::time::UNIX_EPOCH + std::time::Duration::from_secs(s)));
            level.add(sub_path, &full, is_dir, size, modified);
        }
        Ok(())
    })();
    if let Err(e) = read {
        // Fall back to the system tar for archives the library cannot read
        level = Level::default();
        let gz = file_path.ends_with(".tgz") || file_path.ends_with(".tar.gz") || file_path.ends_with(".oar");
        let out = std::process::Command::new("tar")
            .args([if gz { "-tzf" } else { "-tf" }, file_path])
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|_| e.to_string())?;
        if !out.status.success() {
            return Err(e.to_string());
        }
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let l = line.trim();
            if !l.is_empty() {
                level.add(sub_path, l, false, None, None);
            }
        }
    }
    let mut contents = level.contents;
    for d in level.dirs {
        contents.push(json!({ "name": d, "isDirectory": true, "size": null, "modified": null }));
    }
    sort_items(&mut contents);
    Ok(contents)
}

// GET /archive-contents
pub async fn contents(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let Some(requested) = ctx.q_nonempty("path") else {
        return text(400, "File path is required");
    };
    let sub_path = ctx.q("subPath").unwrap_or("").to_string();
    let base = app.base_dir();
    let file_path = jsutil::join(&[&base, requested]);
    if !file_path.starts_with(&base) {
        return text(403, "Forbidden");
    }
    let ext = jsutil::ext_lower(&file_path);
    let tar_like = is_tar_name(&file_path);
    if !matches!(ext.as_str(), ".zip" | ".rar") && !tar_like {
        return text(400, "Not a supported archive format");
    }
    let result = if ext == ".zip" {
        zip_contents(&app, &file_path, &sub_path, "zip-contents", zip_all_entries, "zip-all-entries-v1").await
    } else if ext == ".rar" {
        zip_contents(&app, &file_path, &sub_path, "rar-contents", rar_all_entries, "rar-all-entries-v1").await
    } else {
        let key = app.cache.generate_key(&file_path, "tar-contents", &sub_path);
        if let Some(v @ Value::Array(_)) = app.cache.get("archive-contents", &key, Some(&file_path)) {
            return crate::app::json(&v);
        }
        let (fp, sp) = (file_path.clone(), sub_path.clone());
        match tokio::task::spawn_blocking(move || tar_level(&fp, &sp)).await {
            Ok(Ok(items)) => {
                app.cache.set("archive-contents", &key, &Value::Array(items.clone()), Some(&file_path));
                Ok(items)
            }
            Ok(Err(e)) => Err(e),
            Err(e) => Err(e.to_string()),
        }
    };
    match result {
        Ok(items) => crate::app::json(&Value::Array(items)),
        Err(e) => {
            crate::error!(" ❌ Archive contents error: {}", e);
            text(500, format!("Archive reading error: {}", e))
        }
    }
}

// ---------------------------------------------------------------------------------------------
// GET /archive-file

const TEXT_EXTENSIONS: &[&str] = &[
    ".txt", ".md", ".js", ".css", ".json", ".py", ".java", ".c", ".cpp", ".h", ".hpp", ".go", ".rs", ".csv", ".srt", ".xml", ".yaml", ".yml",
    ".ini", ".conf", ".log", ".sh", ".bat", ".ps1", ".sql", ".php", ".rb", ".swift", ".kt", ".dart", ".r", ".scala", ".clj", ".elm", ".vue",
    ".jsx", ".tsx", ".ts", ".less", ".scss", ".sass", ".styl", ".svelte", ".astro", ".lsl", ".lua", ".pl", ".asm", ".s", ".vb", ".pas",
    ".f90", ".f95", ".f03", ".f08", ".for", ".cobol", ".cob", ".zig", ".m", ".mm", ".groovy", ".gradle", ".cmake", ".dockerfile",
];

enum Mode {
    Text,
    Typed(&'static str),
    Hex,
}

fn mode_for(name: &str) -> Mode {
    let ext = jsutil::ext_lower(name);
    if !ext.is_empty() && TEXT_EXTENSIONS.contains(&ext.as_str()) {
        Mode::Text
    } else if let Some(m) = crate::config::archive_mime_type(name) {
        Mode::Typed(m)
    } else {
        Mode::Hex
    }
}

/// Send `reader` as the response for `name` in the mode its extension calls for.
fn write_entry(w: &mut crate::util::StreamWriter, reader: &mut dyn Read, hex: bool) -> Result<(), String> {
    if hex {
        let mut buf = Vec::with_capacity(512);
        reader.take(512).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        w.start();
        w.write_all(hex_dump(&buf).as_bytes()).map_err(|e| e.to_string())?;
        return Ok(());
    }
    w.start();
    std::io::copy(reader, w).map_err(|e| e.to_string())?;
    Ok(())
}

fn response_for(name: &str, body: axum::body::Body) -> Response {
    let base = jsutil::basename(name);
    let mut b = Response::builder().status(200);
    match mode_for(name) {
        Mode::Text => {
            b = b.header(header::CONTENT_TYPE, "text/plain; charset=utf-8").header(header::CONTENT_DISPOSITION, inline_disposition(&base));
        }
        Mode::Typed(m) => {
            b = b.header(header::CONTENT_TYPE, m).header(header::CONTENT_DISPOSITION, inline_disposition(&base));
        }
        Mode::Hex => {
            b = b
                .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .header("x-content-mode", "hex")
                .header(header::CONTENT_DISPOSITION, inline_disposition(&format!("{}.hex", base)));
        }
    }
    b.body(body).unwrap()
}

pub async fn file(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let (Some(archive), Some(target)) = (ctx.q_nonempty("archive"), ctx.q_nonempty("file")) else {
        return text(400, "Archive and file path are required");
    };
    let base = app.base_dir();
    let archive_path = jsutil::join(&[&base, archive]);
    if !archive_path.starts_with(&base) {
        return text(403, "Forbidden");
    }
    let ext = jsutil::ext_lower(&archive_path);
    let target = target.to_string();
    let hex = matches!(mode_for(&target), Mode::Hex);
    let result = if ext == ".zip" {
        let t = target.clone();
        blocking_stream(move |w| {
            let clean = t.replace('\\', "/");
            let clean = clean.trim_start_matches('/').to_string();
            let segs: Vec<&str> = clean.split('/').collect();
            let last_two = segs[segs.len().saturating_sub(2)..].join("/");
            let without_first = segs.get(1..).map(|s| s.join("/")).unwrap_or_default();
            let mut z = open_zip(&archive_path).map_err(|e| e.to_string())?;
            let idx = (0..z.len()).find(|&i| {
                let Some(name) = z.name_for_index(i) else { return false };
                let p = name.replace('\\', "/");
                let p = p.trim_start_matches('/');
                p == clean || (!last_two.is_empty() && p.ends_with(&format!("/{}", last_two))) || p == without_first
            });
            let idx = idx.ok_or("File not found in archive")?;
            let mut f = z.by_index(idx).map_err(|e| e.to_string())?;
            write_entry(w, &mut f, hex)
        })
        .await
    } else if ext == ".rar" {
        let t = target.clone();
        blocking_stream(move |w| {
            let data = crate::comics::rar_extract_lib(&archive_path, &t)?.ok_or("File not found in archive")?;
            write_entry(w, &mut &data[..], hex)
        })
        .await
    } else if is_tar_name(&archive_path) {
        let t = target.clone();
        blocking_stream(move |w| {
            let mut ar = open_tar(&archive_path).map_err(|e| e.to_string())?;
            for entry in ar.entries().map_err(|e| e.to_string())? {
                let mut entry = entry.map_err(|e| e.to_string())?;
                if String::from_utf8_lossy(&entry.path_bytes()) == t.as_str() {
                    return write_entry(w, &mut entry, hex);
                }
            }
            Err("File not found in archive".into())
        })
        .await
    } else {
        Err("Unsupported archive format".into())
    };
    match result {
        Ok(body) => response_for(&target, body),
        Err(e) => {
            crate::error!(" ❌ Archive file extraction error: {}", e);
            text(500, format!("File extraction error: {}", e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(p: &str, dir: bool) -> Entry {
        Entry { path: p.into(), is_dir: dir, size: if dir { None } else { Some(1) }, modified: None }
    }

    #[test]
    fn sub_path_levels() {
        let all = vec![e("a", true), e("a/x.txt", false), e("a/b/y.txt", false), e("top.txt", false)];
        let root = build_sub_path_items(&all, "");
        let names: Vec<&str> = root.iter().map(|v| v["name"].as_str().unwrap()).collect();
        assert_eq!(names, vec!["a", "top.txt"]);
        let a = build_sub_path_items(&all, "/a/");
        let names: Vec<&str> = a.iter().map(|v| v["name"].as_str().unwrap()).collect();
        assert_eq!(names, vec!["b", "x.txt"]);
    }
}
