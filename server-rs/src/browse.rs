//! Browsing, file serving, folder picker, search, current path, open-with-default-program and
//! delete / rename / move (routes/browse.routes.js, routes/file-ops.routes.js, file-handlers.js).

use std::fs::FileType;
use std::io::SeekFrom;
use std::path::Path;

use axum::body::Body;
use axum::extract::State;
use axum::http::header;
use axum::response::Response;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::app::{json, text, ApiError, ApiResult, AppRef, Ctx};
use crate::jsutil::{self, iso};

// ---------------------------------------------------------------------------------------------
// Path checks

fn starts_with_path(path: &str, base: &str) -> bool {
    if cfg!(windows) {
        path.len() >= base.len() && path.is_char_boundary(base.len()) && path[..base.len()].eq_ignore_ascii_case(base)
    } else {
        path.starts_with(base)
    }
}

/// utils/pathSecurity.js resolveSafePath: join under the root, reject traversal, resolve symlinks
/// and reject targets outside the real root. Non-existent paths come back as the plain join.
pub fn resolve_safe_path(app: &crate::app::App, requested: &str) -> Result<String, ApiError> {
    let base = app.base_dir();
    let normalized = requested.strip_prefix('/').unwrap_or(requested);
    let joined = jsutil::join(&[&base, normalized]);
    if !starts_with_path(&joined, &base) {
        return Err(ApiError::forbidden("Path outside allowed directory"));
    }
    match jsutil::realpath(&joined) {
        Ok(resolved) => {
            if !starts_with_path(&resolved, &app.base_real()) {
                return Err(ApiError::forbidden("Path outside allowed directory"));
            }
            Ok(resolved)
        }
        Err(_) => Ok(joined),
    }
}

/// Real path with the fallback file-handlers.js used for virtual drives.
fn real_path(p: &str) -> std::io::Result<String> {
    jsutil::realpath(p).or_else(|_| std::fs::canonicalize(p).map(|pb| jsutil::plain_path(&pb.to_string_lossy())))
}

/// Directory entries in the order Node's fs.readdir returns them (libuv sorts them by byte value
/// on Unix; Windows keeps the file system order).
pub fn read_dir_js(dir: &str) -> std::io::Result<Vec<(String, FileType)>> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        out.push((entry.file_name().to_string_lossy().into_owned(), entry.file_type()?));
    }
    if cfg!(unix) {
        out.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    }
    Ok(out)
}

/// Name, isDirectory, size and modified for each entry (stat follows links; dirent type does not).
async fn list_entries(dir: String) -> std::io::Result<Vec<Value>> {
    tokio::task::spawn_blocking(move || {
        let entries = read_dir_js(&dir)?;
        Ok(entries
            .into_iter()
            .filter(|(name, _)| name != ".browser")
            .map(|(name, ft)| {
                let stat = std::fs::metadata(Path::new(&dir).join(&name)).ok();
                let is_dir = ft.is_dir();
                json!({
                    "name": name,
                    "isDirectory": is_dir,
                    "size": stat.as_ref().filter(|_| !is_dir).map(|m| m.len()),
                    "modified": stat.and_then(|m| m.modified().ok()).map(iso),
                })
            })
            .collect())
    })
    .await
    .map_err(std::io::Error::other)?
}

fn js_error_string(e: &std::io::Error) -> String {
    format!("Error: {}", e)
}

// ---------------------------------------------------------------------------------------------
// GET /api/browse

pub async fn browse(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let mut requested = ctx.q("path").unwrap_or("").to_string();
    if requested.is_empty() {
        if let Some(last) = ctx.session.get_str("lastBrowsedPath").filter(|s| !s.is_empty()) {
            crate::info!(" Resuming from session: \"{}\"", last);
            requested = last;
        }
    }
    let base = app.base_dir();
    let unsafe_path = jsutil::join(&[&base, &requested]);
    if !unsafe_path.starts_with(&base) {
        crate::warn!(" ❌ Forbidden access attempt to: {}", unsafe_path);
        return text(403, "Forbidden");
    }
    let dir = match real_path(&unsafe_path) {
        Ok(d) => d,
        Err(e) => {
            crate::warn!(" ❌ Path resolution error for {}: {}", unsafe_path, e);
            return text(404, "Directory not found");
        }
    };
    if !dir.starts_with(&app.base_real()) || !dir.starts_with(&base) {
        crate::warn!(" ❌ Forbidden (symlink/base escape) to: {}", dir);
        return text(403, "Forbidden");
    }
    crate::info!(" GET /api/browse - path: \"{}\"", requested);
    match list_entries(dir).await {
        Ok(files) => {
            ctx.session.set("lastBrowsedPath", Value::String(requested.clone()));
            json(&json!({ "files": files, "currentPath": requested, "basePath": base }))
        }
        Err(e) => {
            crate::error!(" ❌ Browse error: {}", e);
            text(500, js_error_string(&e))
        }
    }
}

// GET /files/list
pub async fn file_list(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let base = app.base_dir();
    let dir = jsutil::join(&[&base, ctx.q("path").unwrap_or("")]);
    if !dir.starts_with(&base) {
        return text(403, "Forbidden");
    }
    match list_entries(dir).await {
        Ok(files) => json(&Value::Array(files)),
        Err(e) => text(500, js_error_string(&e)),
    }
}

// ---------------------------------------------------------------------------------------------
// GET /files (with byte ranges)

pub async fn serve_file(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let Some(requested) = ctx.q_nonempty("path") else {
        return text(400, "File path is required");
    };
    let decoded = jsutil::decode_or_raw(requested);
    let base = app.base_dir();
    let file_path = jsutil::join(&[&base, &decoded]);
    if !file_path.starts_with(&base) {
        crate::warn!(" ❌ Forbidden file access attempt: {}", file_path);
        return text(403, "Forbidden");
    }
    let meta = match tokio::fs::metadata(&file_path).await {
        Ok(m) => m,
        Err(_) => return text(404, "File not found"),
    };
    if meta.is_dir() {
        return text(400, "Requested resource is a directory, not a file");
    }
    let content_type = crate::config::mime_type(&jsutil::ext_lower(&file_path)).unwrap_or("application/octet-stream");
    let size = meta.len();
    let range = ctx.header("range").map(String::from);
    serve_path_range(&file_path, size, content_type, range.as_deref()).await
}

/// Parse "bytes=a-b" the way the original did, plus suffix ranges and clamping.
fn parse_range(range: &str, size: u64) -> Option<(u64, u64)> {
    let spec = range.trim().strip_prefix("bytes=")?;
    let spec = spec.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let (start, end) = if a.is_empty() {
        let n: u64 = b.trim().parse().ok()?;
        (size.saturating_sub(n), size.saturating_sub(1))
    } else {
        let start: u64 = jsutil::parse_int(a)?.max(0) as u64;
        let end = if b.trim().is_empty() { size.saturating_sub(1) } else { (jsutil::parse_int(b)?.max(0) as u64).min(size.saturating_sub(1)) };
        (start, end)
    };
    Some((start, end))
}

pub async fn serve_path_range(path: &str, size: u64, content_type: &str, range: Option<&str>) -> Response {
    let mut file = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(e) => return text(500, e.to_string()),
    };
    if let Some(range) = range {
        let Some((start, end)) = parse_range(range, size).filter(|(s, e)| s <= e && *s < size.max(1)) else {
            return Response::builder()
                .status(416)
                .header(header::CONTENT_RANGE, format!("bytes */{}", size))
                .body(Body::empty())
                .unwrap();
        };
        if file.seek(SeekFrom::Start(start)).await.is_err() {
            return text(500, "Seek failed");
        }
        let len = end - start + 1;
        let stream = tokio_util::io::ReaderStream::with_capacity(file.take(len), 256 * 1024);
        return Response::builder()
            .status(206)
            .header(header::CONTENT_RANGE, format!("bytes {}-{}/{}", start, end, size))
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_LENGTH, len)
            .header(header::CONTENT_TYPE, content_type)
            .body(Body::from_stream(stream))
            .unwrap();
    }
    let stream = tokio_util::io::ReaderStream::with_capacity(file, 256 * 1024);
    Response::builder()
        .status(200)
        .header(header::CONTENT_LENGTH, size)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .body(Body::from_stream(stream))
        .unwrap()
}

// ---------------------------------------------------------------------------------------------
// GET /api/library

fn thumbnail_type(ext: &str) -> &'static str {
    match ext {
        ".mp4" | ".avi" | ".mov" | ".mkv" | ".webm" | ".mpg" | ".mpeg" | ".wmv" | ".m4v" | ".flv" => "video",
        ".jpg" | ".jpeg" | ".jfif" | ".pjpeg" | ".pjp" | ".png" | ".gif" | ".webp" | ".bmp" => "image",
        ".pdf" => "pdf",
        ".cbz" | ".cbr" => "comic",
        ".epub" => "epub",
        ".docx" | ".doc" => "docx",
        _ => "generic",
    }
}

pub async fn library(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let requested = ctx.q("path").unwrap_or("").to_string();
    let base = app.base_dir();
    let unsafe_path = jsutil::join(&[&base, &requested]);
    if !unsafe_path.starts_with(&base) {
        return text(403, "Forbidden");
    }
    let Ok(dir) = real_path(&unsafe_path) else {
        return text(404, "Directory not found");
    };
    if !dir.starts_with(&app.base_real()) {
        return text(403, "Forbidden");
    }
    let result = tokio::task::spawn_blocking(move || -> std::io::Result<Vec<Value>> {
        let entries = read_dir_js(&dir)?;
        Ok(entries
            .into_iter()
            .filter(|(n, _)| n != ".browser")
            .filter_map(|(name, ft)| {
                let stat = std::fs::metadata(Path::new(&dir).join(&name)).ok()?;
                let modified = stat.modified().ok().map(iso);
                if ft.is_dir() {
                    return Some(json!({ "name": name, "isDirectory": true, "size": null, "modified": modified,
                        "thumbnailType": "directory", "extension": "" }));
                }
                let ext = jsutil::ext_lower(&name);
                Some(json!({
                    "name": name, "isDirectory": false, "size": stat.len(), "modified": modified,
                    "thumbnailType": thumbnail_type(&ext),
                    "extension": ext.get(1..).unwrap_or(""),
                }))
            })
            .collect())
    })
    .await;
    match result {
        Ok(Ok(files)) => {
            let total = files.len();
            json(&json!({ "path": requested, "files": files, "totalFiles": total }))
        }
        Ok(Err(e)) => text(500, js_error_string(&e)),
        Err(e) => text(500, e.to_string()),
    }
}

// ---------------------------------------------------------------------------------------------
// Current path (session + .latest file)

fn latest_file(app: &crate::app::App) -> std::path::PathBuf {
    app.app_dir.join(".latest")
}

pub fn read_latest_path(app: &crate::app::App) -> String {
    let Ok(content) = std::fs::read_to_string(latest_file(app)) else { return String::new() };
    let content = content.trim().to_string();
    let base = app.base_dir();
    let full = jsutil::resolve(&base, &content);
    if !content.is_empty() && full.starts_with(&jsutil::resolve(&base, "")) && Path::new(&full).exists() {
        content
    } else {
        String::new()
    }
}

pub fn save_latest_path(app: &crate::app::App, p: &str) {
    if let Err(e) = std::fs::write(latest_file(app), p) {
        crate::warn!("Failed to save .latest file: {}", e);
    }
}

pub async fn get_current_path(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let current = ctx
        .session
        .get_str("currentPath")
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| read_latest_path(&app));
    json(&json!({ "currentPath": current }))
}

pub async fn post_current_path(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let new_path = match ctx.b("path") {
        Some(Value::String(s)) => s.clone(),
        Some(v) if jsutil::truthy(Some(v)) => v.to_string(),
        _ => String::new(),
    };
    ctx.session.set("currentPath", Value::String(new_path.clone()));
    ctx.session.set("lastBrowsedPath", Value::String(new_path.clone()));
    save_latest_path(&app, &new_path);
    json(&json!({ "success": true, "currentPath": new_path }))
}

// ---------------------------------------------------------------------------------------------
// GET /api/directories (folder picker)

pub async fn directories(State(app): State<AppRef>, ctx: Ctx) -> ApiResult {
    let current = ctx.q("path").unwrap_or("").to_string();
    let full = resolve_safe_path(&app, &current)?;
    let entries = read_dir_js(&full).map_err(|_| ApiError::not_found("Directory not found"))?;
    let mut dirs: Vec<(String, String)> = entries
        .into_iter()
        .filter(|(_, ft)| ft.is_dir())
        .map(|(name, _)| {
            let p = if current.is_empty() { name.clone() } else { format!("{}/{}", current, name) };
            (name, p)
        })
        .collect();
    dirs.sort_by(|a, b| jsutil::locale_cmp(&a.0.to_lowercase(), &b.0.to_lowercase()));
    let parent = if current.is_empty() {
        Value::Null
    } else {
        let d = jsutil::dirname(&current);
        Value::String(if d == "." { String::new() } else { d })
    };
    let list: Vec<Value> = dirs.into_iter().map(|(name, path)| json!({ "name": name, "path": path })).collect();
    Ok(json(&json!({ "currentPath": current, "parentPath": parent, "directories": list })))
}

// ---------------------------------------------------------------------------------------------
// GET /api/search: recursive, case-insensitive; every term must appear in the name

const SEARCH_MAX_RESULTS: usize = 200;
const SEARCH_MAX_DIRS: usize = 20000;

pub async fn search(State(app): State<AppRef>, ctx: Ctx) -> ApiResult {
    let q = ctx.q("q").unwrap_or("").to_lowercase();
    let terms: Vec<String> = q.split_whitespace().map(String::from).collect();
    if terms.is_empty() {
        return Ok(json(&json!({ "results": [], "truncated": false })));
    }
    let start = ctx.q("path").unwrap_or("").to_string();
    let full_start = resolve_safe_path(&app, &start)?;
    let app2 = app.clone();
    let out = tokio::task::spawn_blocking(move || -> Result<(Vec<Value>, bool), ApiError> {
        let mut results = Vec::new();
        let mut queue = std::collections::VecDeque::from([start.clone()]);
        let mut visited = 0usize;
        let mut truncated = false;
        while let Some(rel) = queue.pop_front() {
            if truncated {
                break;
            }
            let abs = if rel == start { full_start.clone() } else {
                match resolve_safe_path(&app2, &rel) { Ok(p) => p, Err(_) => continue }
            };
            let entries = match read_dir_js(&abs) {
                Ok(e) => e,
                Err(_) if rel == start => return Err(ApiError::not_found("Directory not found")),
                Err(_) => continue,
            };
            visited += 1;
            if visited > SEARCH_MAX_DIRS {
                truncated = true;
                break;
            }
            for (name, ft) in entries {
                if name == ".browser" {
                    continue;
                }
                let lower = name.to_lowercase();
                if terms.iter().all(|t| lower.contains(t.as_str())) {
                    if results.len() >= SEARCH_MAX_RESULTS {
                        truncated = true;
                        break;
                    }
                    results.push(json!({ "name": name, "dir": rel, "isDirectory": ft.is_dir() }));
                }
                // Symlinked directories are not followed, so the walk cannot leave the root or loop
                if ft.is_dir() {
                    queue.push_back(if rel.is_empty() { name.clone() } else { format!("{}/{}", rel, name) });
                }
            }
        }
        Ok((results, truncated))
    })
    .await
    .map_err(ApiError::internal)??;
    Ok(json(&json!({ "results": out.0, "truncated": out.1 })))
}

// ---------------------------------------------------------------------------------------------
// POST /api/open-file: open with the system's default program

pub async fn open_file(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let Some(file_path) = ctx.b_str("filePath").filter(|s| !s.is_empty()) else {
        return crate::app::json_status(400, &json!({ "error": "File path is required" }));
    };
    let base = app.base_dir();
    let rel = file_path.strip_prefix('/').unwrap_or(file_path);
    let full = jsutil::resolve(&base, rel);
    if !full.starts_with(&jsutil::resolve(&base, "")) {
        return crate::app::json_status(403, &json!({ "error": "Access denied: file outside allowed directory" }));
    }
    if !Path::new(&full).exists() {
        return crate::app::json_status(404, &json!({ "error": "File not found" }));
    }
    let mut cmd = if cfg!(windows) {
        // explorer.exe opens a file with its associated program without going through a shell
        let mut c = std::process::Command::new("explorer.exe");
        c.arg(&full);
        c
    } else if cfg!(target_os = "macos") {
        let mut c = std::process::Command::new("open");
        c.arg(&full);
        c
    } else {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&full);
        c
    };
    cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    match cmd.spawn() {
        Ok(_) => {
            crate::info!("Opened file with default program: {}", file_path);
            json(&json!({ "success": true, "message": "File opened successfully" }))
        }
        Err(e) => crate::app::json_status(500, &json!({ "error": e.to_string() })),
    }
}

// ---------------------------------------------------------------------------------------------
// File operations

/// Annotation keys use forward slashes whatever the platform.
fn annotation_key(p: &str) -> String {
    p.replace('\\', "/")
}

pub async fn delete_file(State(app): State<AppRef>, ctx: Ctx) -> ApiResult {
    let p = ctx.b_str("path").filter(|s| !s.is_empty()).ok_or_else(|| ApiError::bad_request("File path is required"))?;
    let full = resolve_safe_path(&app, p)?;
    let meta = tokio::fs::metadata(&full).await?;
    if meta.is_dir() {
        tokio::fs::remove_dir_all(&full).await?;
    } else {
        tokio::fs::remove_file(&full).await?;
    }
    Ok(json(&json!({ "success": true, "message": "File deleted successfully" })))
}

pub async fn rename_file(State(app): State<AppRef>, ctx: Ctx) -> ApiResult {
    let (Some(old), Some(new_name)) = (
        ctx.b_str("oldPath").filter(|s| !s.is_empty()),
        ctx.b_str("newName").filter(|s| !s.is_empty()),
    ) else {
        return Err(ApiError::bad_request("Old path and new name are required"));
    };
    let full_old = resolve_safe_path(&app, old)?;
    let full_new = jsutil::join(&[&jsutil::dirname(&full_old), new_name]);
    let base = jsutil::resolve(&app.base_dir(), "");
    if !starts_with_path(&full_new, &base) {
        return Err(ApiError::forbidden("New path outside allowed directory"));
    }
    if Path::new(&full_new).exists() {
        return Err(ApiError::conflict("File with that name already exists"));
    }
    tokio::fs::rename(&full_old, &full_new).await?;
    let old_rel = jsutil::relative(&base, &full_old);
    let new_rel = jsutil::relative(&base, &full_new);
    crate::annotations::rename_annotation(&app, &annotation_key(&old_rel), &annotation_key(&new_rel));
    Ok(json(&json!({ "success": true, "message": "File renamed successfully", "newPath": new_rel })))
}

pub async fn move_file(State(app): State<AppRef>, ctx: Ctx) -> ApiResult {
    let source = ctx.b_str("sourcePath").filter(|s| !s.is_empty());
    let target = ctx.b("targetDir");
    let (Some(source), Some(target)) = (source, target.filter(|v| !v.is_null())) else {
        return Err(ApiError::bad_request("Source path and target directory are required"));
    };
    let target = target.as_str().map(String::from).unwrap_or_else(|| target.to_string());
    let full_source = resolve_safe_path(&app, source)?;
    let full_target = resolve_safe_path(&app, &target)?;
    match tokio::fs::metadata(&full_target).await {
        Ok(m) if m.is_dir() => {}
        Ok(_) => return Err(ApiError::bad_request("Target is not a directory")),
        Err(_) => return Err(ApiError::not_found("Target directory not found")),
    }
    if !Path::new(&full_source).exists() {
        return Err(ApiError::not_found("Source file not found"));
    }
    let full_new = jsutil::join(&[&full_target, &jsutil::basename(&full_source)]);
    if Path::new(&full_new).exists() {
        return Err(ApiError::conflict("File with that name already exists in target directory"));
    }
    tokio::fs::rename(&full_source, &full_new).await?;
    let base = jsutil::resolve(&app.base_dir(), "");
    let old_rel = jsutil::relative(&base, &full_source);
    let new_rel = jsutil::relative(&base, &full_new);
    crate::annotations::rename_annotation(&app, &annotation_key(&old_rel), &annotation_key(&new_rel));
    Ok(json(&json!({ "success": true, "message": "File moved successfully", "newPath": new_rel })))
}
