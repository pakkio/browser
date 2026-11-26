//! Comic reader: page lists and pages of CBZ / ZIP (images and PDFs inside them) and CBR
//! archives, and videos stored inside them (lib/comic-handlers.js).
//! RAR uses the official unrar library in-process; a native `unrar` program is the fallback.

use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::header;
use axum::response::Response;
use serde_json::{json, Value};

use crate::app::{bytes, json as json_resp, text, with_header, App, AppRef, Ctx};
use crate::jsutil::{self, utf16_cmp};
use crate::util::{blocking_stream, run, KeyedLocks};

const MAX_CONCURRENT: usize = 10;
const MAX_PER_FILE: usize = 120;
const WINDOW: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct ComicState {
    lists: KeyedLocks,
    active: AtomicUsize,
    per_file: Mutex<HashMap<String, VecDeque<Instant>>>,
}

struct ActiveGuard<'a>(&'a AtomicUsize);
impl Drop for ActiveGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------------------------
// Native unrar (optional fallback)

fn find_unrar() -> Option<&'static str> {
    static FOUND: OnceLock<Option<String>> = OnceLock::new();
    FOUND
        .get_or_init(|| {
            let mut candidates = vec!["unrar".to_string()];
            if cfg!(windows) {
                for var in ["ProgramFiles", "ProgramFiles(x86)"] {
                    if let Some(base) = std::env::var_os(var) {
                        candidates.push(Path::new(&base).join("WinRAR").join("UnRAR.exe").to_string_lossy().into_owned());
                    }
                }
            }
            let found = candidates.into_iter().find(|c| {
                let mut cmd = std::process::Command::new(c);
                cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(0x0800_0000);
                }
                cmd.status().is_ok()
            });
            crate::info!("{}", found.as_ref().map(|c| format!(" 📖 Native unrar available: {}", c)).unwrap_or_else(|| " 📖 No native unrar found".into()));
            found
        })
        .as_deref()
}

/// List with the native unrar (bare list, Unicode output, never prompt for a password).
async fn rar_list_native(file: &str) -> Result<Vec<String>, String> {
    let unrar = find_unrar().ok_or("No native unrar")?;
    let out = run(unrar, &["lb", "-p-", "-scur", file], Duration::from_secs(120)).await.map_err(|e| e.to_string())?;
    if !out.success() {
        return Err(format!("unrar exited with {:?}", out.status));
    }
    // -scur asks for Unicode output, which unrar writes as UTF-16LE; otherwise it is UTF-8
    let text = if out.stdout.contains(&0) {
        let units: Vec<u16> = out.stdout.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&units)
    } else {
        out.stdout_str()
    };
    Ok(text.trim_start_matches('\u{feff}').lines().filter(|l| !l.is_empty()).map(String::from).collect())
}

/// Bytes of one entry with the unrar library; Ok(None) when the archive has no such entry.
pub fn rar_extract_lib(archive: &str, entry: &str) -> Result<Option<Vec<u8>>, String> {
    let mut open = unrar::Archive::new(archive).open_for_processing().map_err(|e| format!("File is not RAR archive ({})", e))?;
    let wanted = entry.replace('\\', "/");
    loop {
        let Some(header) = open.read_header().map_err(|e| e.to_string())? else { return Ok(None) };
        let name = header.entry().filename.to_string_lossy().replace('\\', "/");
        if name == wanted && header.entry().is_file() {
            let (data, _) = header.read().map_err(|e| e.to_string())?;
            return Ok(Some(data));
        }
        open = header.skip().map_err(|e| e.to_string())?;
    }
}

async fn rar_extract(archive: &str, entry: &str, limit_secs: u64) -> Result<Vec<u8>, String> {
    let (a, e) = (archive.to_string(), entry.to_string());
    let lib = tokio::task::spawn_blocking(move || rar_extract_lib(&a, &e)).await.map_err(|e| e.to_string())?;
    match lib {
        Ok(Some(data)) if !data.is_empty() => return Ok(data),
        Ok(_) => {}
        Err(err) => crate::warn!(" ⚠️ CBR: unrar library extraction failed: {}", err),
    }
    let unrar = find_unrar().ok_or_else(|| format!("File not found in archive: {}", entry))?;
    let out = run(unrar, &["p", "-inul", "-p-", archive, entry], Duration::from_secs(limit_secs)).await.map_err(|e| e.to_string())?;
    if out.timed_out {
        return Err("CBR extraction timeout - The file is very large, corrupted, or the system is under heavy load. Please try again or use a different file format.".into());
    }
    if !out.success() || out.stdout.is_empty() {
        return Err(format!("unrar failed: {}", out.stderr_str().trim()));
    }
    Ok(out.stdout)
}

// ---------------------------------------------------------------------------------------------
// Page lists

fn read_header(path: &str, n: usize) -> std::io::Result<Vec<u8>> {
    let mut f = std::fs::File::open(path)?;
    let mut buf = vec![0u8; n];
    let mut read = 0;
    while read < n {
        let k = f.read(&mut buf[read..])?;
        if k == 0 {
            break;
        }
        read += k;
    }
    buf.truncate(read);
    Ok(buf)
}

fn check_zip_magic(path: &str) -> Result<(), String> {
    let h = read_header(path, 4).map_err(|_| "Unable to validate file format".to_string())?;
    if h.len() >= 3 && h[0] == 0x50 && h[1] == 0x4b && matches!(h[2], 0x03 | 0x05 | 0x07) {
        Ok(())
    } else {
        Err("File is not a valid ZIP archive".into())
    }
}

fn is_page_name(name: &str) -> bool {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"\.(jpg|jpeg|jfif|pjpeg|pjp|png|gif|webp|bmp|tiff|tif|pdf)$").unwrap())
        .is_match(&name.trim().to_lowercase())
}

fn is_cbr_media(name: &str) -> bool {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?i)\.(jpg|jpeg|jfif|pjpeg|pjp|png|gif|webp|bmp|tiff|tif|mp4|avi|mov|mkv|webm|mpg|mpeg|wmv)$").unwrap())
        .is_match(name)
}

/// Image and PDF entries of a ZIP, sorted like JavaScript's default sort.
fn zip_page_names(path: &str) -> Result<Vec<String>, String> {
    if !Path::new(path).exists() {
        return Err(format!("File not found: {}", path));
    }
    check_zip_magic(path)?;
    let z = crate::archives::open_zip(path).map_err(|e| {
        let m = e.to_string();
        if m.contains("truncated") { "Archive file is truncated or incomplete".to_string() } else { "Archive file is corrupted or not a valid ZIP file".to_string() }
    })?;
    let mut names: Vec<String> = Vec::new();
    for i in 0..z.len() {
        if let Some(n) = z.name_for_index(i) {
            if is_page_name(n) && !names.iter().any(|x| x == n) {
                names.push(n.to_string());
            }
        }
    }
    names.sort_by(|a, b| utf16_cmp(a, b));
    Ok(names)
}

/// The cover of a comic, for its thumbnail.
pub enum Cover {
    Image(Vec<u8>),
    /// A PDF entry copied to this temporary file (its first page is the cover)
    Pdf(std::path::PathBuf),
}

/// The cover without building the page list: a ZIP's sorted first page comes from its central
/// directory alone; for a RAR, the first image stored in the archive, so only its start is read
/// (on a network drive the full listing can mean reading the whole archive).
pub fn cover_fast(path: &str) -> Result<Cover, String> {
    let header = read_header(path, 64).map_err(|e| e.to_string())?;
    if header.is_empty() {
        return Err("Corrupted: file is empty (0 bytes)".into());
    }
    if header.len() >= 16 && header.iter().all(|&b| b == 0) {
        return Err("Corrupted: file starts with zero bytes (incomplete download)".into());
    }
    if header.starts_with(b"Rar!\x1a\x07") {
        let mut open = unrar::Archive::new(path)
            .open_for_processing()
            .map_err(|e| format!("Corrupted RAR archive: {}", e))?;
        loop {
            let Some(hdr) = open.read_header().map_err(|e| format!("Corrupted RAR archive: {}", e))? else {
                return Err("No pages".into());
            };
            let name = hdr.entry().filename.to_string_lossy().into_owned();
            if hdr.entry().is_file() && is_page_name(&name) && jsutil::ext_lower(&name) != ".pdf" {
                let (data, _) = hdr.read().map_err(|e| format!("Corrupted RAR archive: {}", e))?;
                return Ok(Cover::Image(data));
            }
            open = hdr.skip().map_err(|e| format!("Corrupted RAR archive: {}", e))?;
        }
    }
    if !header.starts_with(b"PK\x03\x04") && !header.starts_with(b"PK\x05\x06") {
        return Err("Corrupted: invalid archive header (not a RAR or ZIP file)".into());
    }
    let first = zip_page_names(path)
        .map_err(|e| format!("Corrupted ZIP archive: {}", e))?
        .into_iter()
        .next()
        .ok_or("No pages")?;
    if jsutil::ext_lower(&first) == ".pdf" {
        return zip_entry_to_temp(path, &first).map(Cover::Pdf);
    }
    let mut z = crate::archives::open_zip(path).map_err(|e| format!("Corrupted ZIP archive: {}", e))?;
    let mut f = z.by_name(&first).map_err(|e| format!("Corrupted ZIP archive: {}", e))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(|e| format!("Corrupted ZIP archive: {}", e))?;
    Ok(Cover::Image(buf))
}

/// Copy one ZIP entry to a temporary file.
pub fn zip_entry_to_temp(archive: &str, entry: &str) -> Result<std::path::PathBuf, String> {
    let mut z = crate::archives::open_zip(archive).map_err(|e| e.to_string())?;
    let mut f = z.by_name(entry).map_err(|_| format!("File not found in archive: {}", entry))?;
    let out = crate::util::temp_dir("filebrowser-comics").join(crate::util::unique_name(&jsutil::basename(entry)));
    let mut w = std::fs::File::create(&out).map_err(|e| e.to_string())?;
    std::io::copy(&mut f, &mut w).map_err(|e| e.to_string())?;
    Ok(out)
}

/// The pages of a comic: objects {file, type:'image'} / {file, pdfPage} for ZIPs, plain entry
/// names for RARs (and for RARs that turned out to be ZIPs). Cached on disk.
pub async fn file_list(app: &App, file_path: &str) -> Result<Vec<Value>, String> {
    let key = app.cache.generate_key(file_path, "comic-list", "");
    if let Some(Value::Array(a)) = app.cache.get("comic-lists", &key, Some(file_path)) {
        return Ok(a);
    }
    let _guard = app.comics.lists.lock(&key).await;
    if let Some(Value::Array(a)) = app.cache.get("comic-lists", &key, Some(file_path)) {
        return Ok(a);
    }
    if !Path::new(file_path).exists() {
        return Err(format!("File not found: {}", file_path));
    }
    let ext = jsutil::ext_lower(file_path);
    let list: Vec<Value> = if ext == ".cbz" || ext == ".zip" {
        let fp = file_path.to_string();
        let names = tokio::task::spawn_blocking(move || zip_page_names(&fp)).await.map_err(|e| e.to_string())??;
        let mut expanded = Vec::new();
        for name in names {
            if jsutil::ext_lower(&name) == ".pdf" {
                let (fp, n) = (file_path.to_string(), name.clone());
                let temp = tokio::task::spawn_blocking(move || zip_entry_to_temp(&fp, &n)).await.map_err(|e| e.to_string())??;
                match crate::media::pdf::page_count(&temp.to_string_lossy()).await {
                    Ok(count) => {
                        for i in 1..=count {
                            expanded.push(json!({ "file": name, "pdfPage": i }));
                        }
                    }
                    Err(e) => crate::error!(" ❌ PDF processing error for {}: {}", name, e),
                }
                let _ = std::fs::remove_file(temp);
            } else {
                expanded.push(json!({ "file": name, "type": "image" }));
            }
        }
        expanded
    } else if ext == ".cbr" {
        let fp = file_path.to_string();
        let lib = tokio::task::spawn_blocking(move || crate::archives::rar_all_entries(&fp)).await.map_err(|e| e.to_string())?;
        let names: Result<Vec<String>, String> = match lib {
            Ok(entries) => Ok(entries.into_iter().filter(|e| !e.is_dir).map(|e| e.path).collect()),
            Err(lib_err) => match rar_list_native(file_path).await {
                Ok(n) => Ok(n),
                Err(_) => Err(lib_err),
            },
        };
        match names {
            Ok(names) => {
                let mut media: Vec<String> = names.into_iter().filter(|n| is_cbr_media(n)).collect();
                media.sort_by(|a, b| utf16_cmp(a, b));
                media.into_iter().map(Value::String).collect()
            }
            Err(e) if ["File is not RAR archive", "corrupted", "invalid", "truncated"].iter().any(|m| e.contains(m)) => {
                crate::warn!(" ⚠️ CBR: may be a ZIP with a .cbr extension, trying ZIP: {}", e);
                let fp = file_path.to_string();
                match tokio::task::spawn_blocking(move || zip_page_names(&fp)).await.map_err(|e| e.to_string())? {
                    Ok(n) => n.into_iter().map(Value::String).collect(),
                    Err(_) => return Err("Archive file is corrupted or not a valid RAR/ZIP file".into()),
                }
            }
            Err(e) => return Err(e),
        }
    } else {
        return Err(format!("Unsupported archive format: {}", ext));
    };
    app.cache.set("comic-lists", &key, &Value::Array(list.clone()), Some(file_path));
    Ok(list)
}

fn is_corruption(msg: &str) -> bool {
    [
        "File is not RAR archive",
        "central directory record signature not found",
        "file is truncated",
        "not a zip file",
        "Archive file is corrupted and cannot be processed",
        "File is not a valid ZIP archive",
    ]
    .iter()
    .any(|m| msg.contains(m))
}

// ---------------------------------------------------------------------------------------------
// Page extraction

/// A page from a ZIP comic: an image entry, or one page of a PDF entry rendered to PNG.
async fn page_from_zip(app: &App, file_path: &str, page: i64) -> Result<Response, String> {
    let list = file_list(app, file_path).await?;
    if page < 1 || page as usize > list.len() {
        return Err(format!("Page not found. Found {} images, requested page {}", list.len(), page));
    }
    let target = &list[page as usize - 1];
    let entry = target.as_str().or_else(|| target["file"].as_str()).unwrap_or("").to_string();
    if let Some(pdf_page) = target.get("pdfPage").and_then(Value::as_u64) {
        let (fp, e) = (file_path.to_string(), entry.clone());
        let temp = tokio::task::spawn_blocking(move || zip_entry_to_temp(&fp, &e)).await.map_err(|e| e.to_string())??;
        let temp_s = temp.to_string_lossy().into_owned();
        let result = async {
            let head = read_header(&temp_s, 8).map_err(|e| e.to_string())?;
            if !head.starts_with(b"%PDF-") {
                return Err(format!("Invalid PDF file format: {}", temp_s));
            }
            crate::media::pdf::render_page(&temp_s, pdf_page as u32, 150, 1200, 1600).await
        }
        .await;
        let _ = std::fs::remove_file(&temp);
        return result.map(|png| bytes(200, "image/png", png)).map_err(|e| format!("PDF conversion failed: {}", e));
    }
    let fp = file_path.to_string();
    let e2 = entry.clone();
    let body = blocking_stream(move |w| {
        let mut z = crate::archives::open_zip(&fp).map_err(|e| e.to_string())?;
        let mut f = z.by_name(&e2).map_err(|_| format!("File {} not found in archive", e2))?;
        w.start();
        std::io::copy(&mut f, w).map_err(|e| format!("Stream error while reading page {}: {}", page, e))?;
        Ok(())
    })
    .await?;
    Ok(Response::builder()
        .status(200)
        .header(header::CONTENT_TYPE, crate::config::image_mime_type(&entry))
        .body(body)
        .unwrap())
}

async fn page_from_rar(app: &App, file_path: &str, page: i64) -> Result<Response, String> {
    if app.comics.active.load(Ordering::SeqCst) >= MAX_CONCURRENT {
        return Err("Server busy - too many concurrent comic requests. Please try again in a moment.".into());
    }
    {
        let mut per = app.comics.per_file.lock().unwrap();
        let q = per.entry(file_path.to_string()).or_default();
        while q.front().map(|t| t.elapsed() > WINDOW).unwrap_or(false) {
            q.pop_front();
        }
        if q.len() >= MAX_PER_FILE {
            return Err("Request limit exceeded for this file. Please try again later.".into());
        }
        q.push_back(Instant::now());
    }
    app.comics.active.fetch_add(1, Ordering::SeqCst);
    let _active = ActiveGuard(&app.comics.active);

    let fallback = |e: String| async move {
        crate::warn!(" 🔄 CBR: {}, trying the ZIP route", e);
        page_from_zip(app, file_path, page)
            .await
            .map_err(|_| "Archive file is corrupted and cannot be processed with either CBR or CBZ methods".to_string())
    };
    let list = match file_list(app, file_path).await {
        Ok(l) => l,
        Err(e) => return fallback(e).await,
    };
    if page < 1 || page as usize > list.len() {
        return Err(format!("Page not found. Found {} images, requested page {}", list.len(), page));
    }
    let Some(target) = list[page as usize - 1].as_str().map(String::from) else {
        return fallback("unexpected page entry".into()).await;
    };
    let size = std::fs::metadata(file_path).map(|m| m.len()).unwrap_or(0);
    if size == 0 {
        return Err("File is empty or corrupted - cannot process".into());
    }
    match rar_extract(file_path, &target, 90).await {
        Ok(data) => Ok(bytes(200, crate::config::image_mime_type(&target), data)),
        Err(e) => fallback(e).await,
    }
}

/// Answer a page request for a comic at `file_path` (already validated).
pub async fn preview_for(app: &App, file_path: &str, page: i64) -> Response {
    if !Path::new(file_path).exists() {
        return text(404, "File not found");
    }
    let ext = jsutil::ext_lower(file_path);
    if !matches!(ext.as_str(), ".cbz" | ".cbr" | ".zip") {
        return text(400, "Not a supported archive");
    }
    let result = if ext == ".cbr" { page_from_rar(app, file_path, page).await } else { page_from_zip(app, file_path, page).await };
    match result {
        Ok(r) => r,
        Err(e) => {
            crate::error!(" ❌ Comic extraction error: {}", e);
            if is_corruption(&e) {
                if ext == ".cbr" {
                    return match page_from_zip(app, file_path, page).await {
                        Ok(r) => r,
                        Err(_) => text(422, "Archive file is corrupted and cannot be processed"),
                    };
                }
                return text(422, "Archive file is corrupted or invalid");
            }
            if e.contains("Page not found") {
                return text(404, e);
            }
            if e.contains("Request limit exceeded") || e.contains("Server busy") {
                return with_header(text(429, e), "retry-after", "5");
            }
            text(500, "Comic extraction failed due to an unexpected error")
        }
    }
}

/// Answer a page-count request for a comic at `file_path` (already validated).
pub async fn info_for(app: &App, file_path: &str) -> Response {
    if !Path::new(file_path).exists() {
        return text(404, "File not found");
    }
    let ext = jsutil::ext_lower(file_path);
    if !matches!(ext.as_str(), ".cbz" | ".cbr" | ".zip") {
        return text(400, "Not a supported archive");
    }
    let timeout = Duration::from_secs(45);
    let timed_out = || text(408, "Request timeout - file may be corrupted or too large");
    let result = match tokio::time::timeout(timeout, file_list(app, file_path)).await {
        Err(_) => return timed_out(),
        Ok(r) => r,
    };
    match result {
        Ok(list) => json_resp(&json!({ "pages": list.len(), "format": ext[1..].to_uppercase() })),
        Err(e) => {
            crate::error!(" ❌ Comic info error: {}", e);
            if is_corruption(&e) {
                if ext == ".cbr" {
                    let fp = file_path.to_string();
                    return match tokio::time::timeout(timeout, tokio::task::spawn_blocking(move || zip_page_names(&fp))).await {
                        Err(_) => timed_out(),
                        Ok(Ok(Ok(names))) => json_resp(&json!({ "pages": names.len(), "format": "CBR (ZIP)" })),
                        _ => text(422, "Archive file is corrupted and cannot be processed"),
                    };
                }
                return text(422, "Archive file is corrupted or invalid");
            }
            text(500, "Comic info retrieval failed due to an unexpected error")
        }
    }
}

fn comic_path(app: &App, ctx: &Ctx) -> Result<String, Response> {
    let Some(requested) = ctx.q_nonempty("path") else {
        return Err(text(400, "File path is required"));
    };
    let base = app.base_dir();
    let file = jsutil::join(&[&base, requested]);
    if !file.starts_with(&base) {
        return Err(text(403, "Forbidden"));
    }
    Ok(file)
}

pub fn page_param(ctx: &Ctx) -> i64 {
    ctx.q("page").and_then(jsutil::parse_int).filter(|&p| p != 0).unwrap_or(1)
}

// GET /api/comic-info
pub async fn info(State(app): State<AppRef>, ctx: Ctx) -> Response {
    match comic_path(&app, &ctx) {
        Ok(f) => info_for(&app, &f).await,
        Err(r) => r,
    }
}

// GET /comic-preview
pub async fn preview(State(app): State<AppRef>, ctx: Ctx) -> Response {
    match comic_path(&app, &ctx) {
        Ok(f) => preview_for(&app, &f, page_param(&ctx)).await,
        Err(r) => r,
    }
}

// ---------------------------------------------------------------------------------------------
// GET /archive-video: a video stored inside a comic archive

async fn video_from_zip(file_path: &str, name: &str) -> Result<Response, String> {
    if !Path::new(file_path).exists() {
        return Err(format!("File not found: {}", file_path));
    }
    check_zip_magic(file_path)?;
    let (fp, n) = (file_path.to_string(), name.to_string());
    let body = blocking_stream(move |w| {
        let mut z = crate::archives::open_zip(&fp).map_err(|_| "Archive file is corrupted or not a valid ZIP file".to_string())?;
        let mut f = z.by_name(&n).map_err(|_| format!("Video file {} not found in archive", n))?;
        w.start();
        std::io::copy(&mut f, w).map_err(|e| format!("Stream error while reading video {}: {}", n, e))?;
        Ok(())
    })
    .await?;
    Ok(Response::builder()
        .status(200)
        .header(header::CONTENT_TYPE, crate::config::video_mime_type(name))
        .header(header::ACCEPT_RANGES, "bytes")
        .body(body)
        .unwrap())
}

async fn video_from_rar(file_path: &str, name: &str) -> Result<Response, String> {
    match rar_extract(file_path, name, 60).await {
        Ok(data) => Ok(with_header(bytes(200, crate::config::video_mime_type(name), data), "accept-ranges", "bytes")),
        Err(_) => video_from_zip(file_path, name)
            .await
            .map_err(|_| "Archive file is corrupted and cannot be processed with either CBR or CBZ methods".to_string()),
    }
}

pub async fn archive_video(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let (Some(requested), Some(name)) = (ctx.q_nonempty("path"), ctx.q_nonempty("fileName")) else {
        return text(400, "Archive path and file name are required");
    };
    let base = app.base_dir();
    let file = jsutil::join(&[&base, requested]);
    if !file.starts_with(&base) {
        return text(403, "Forbidden");
    }
    if !Path::new(&file).exists() {
        return text(404, "File not found");
    }
    let ext = jsutil::ext_lower(&file);
    if !matches!(ext.as_str(), ".cbz" | ".cbr" | ".zip") {
        return text(400, "Not a supported archive");
    }
    let result = if ext == ".cbr" { video_from_rar(&file, name).await } else { video_from_zip(&file, name).await };
    match result {
        Ok(r) => r,
        Err(e) => {
            crate::error!(" ❌ Archive video extraction error: {}", e);
            if is_corruption(&e) {
                if ext == ".cbr" {
                    return video_from_zip(&file, name).await.unwrap_or_else(|_| text(422, "Archive file is corrupted and cannot be processed"));
                }
                return text(422, "Archive file is corrupted or invalid");
            }
            if e.contains("File not found") {
                return text(404, e);
            }
            text(500, "Archive video extraction failed due to an unexpected error")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_names() {
        assert!(is_page_name("a/B.JPG "));
        assert!(is_page_name("x.pdf"));
        assert!(!is_page_name("x.txt"));
        assert!(is_cbr_media("clip.MKV"));
    }

    #[test]
    fn corruption_messages() {
        assert!(is_corruption("File is not a valid ZIP archive"));
        assert!(!is_corruption("Archive file is corrupted or not a valid ZIP file"));
    }
}
