//! PDF page count, page rendering and integrity check (file-handlers.js).
//! Pages are rendered with Poppler's pdftoppm; Ghostscript is the fallback.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::response::Response;
use bytes::Bytes;
use serde_json::{json, Value};

use crate::app::{bytes as bytes_resp, json, json_status, text, with_header, AppRef, Ctx};
use crate::jsutil::{self, epoch_ms};
use crate::util::{run, run_first, KeyedLocks};

const CACHE_MAX_BYTES: usize = 100 * 1024 * 1024;
const CACHE_TTL: Duration = Duration::from_secs(60 * 60);

struct CachedPage {
    data: Bytes,
    mtime: i64,
    last_access: Instant,
    created: Instant,
}

#[derive(Default)]
pub struct PdfState {
    pages: Mutex<(HashMap<String, CachedPage>, usize)>,
    inflight: KeyedLocks,
}

impl PdfState {
    fn get(&self, key: &str, mtime: i64) -> Option<Bytes> {
        let mut g = self.pages.lock().unwrap();
        let (map, total) = &mut *g;
        let stale = {
            let e = map.get(key)?;
            e.mtime != mtime || e.created.elapsed() > CACHE_TTL
        };
        if stale {
            if let Some(e) = map.remove(key) {
                *total -= e.data.len();
            }
            return None;
        }
        let e = map.get_mut(key).unwrap();
        e.last_access = Instant::now();
        Some(e.data.clone())
    }

    fn set(&self, key: &str, data: Bytes, mtime: i64) {
        // Never let one huge page take more than half the budget
        if data.len() > CACHE_MAX_BYTES / 2 {
            return;
        }
        let mut g = self.pages.lock().unwrap();
        let (map, total) = &mut *g;
        if let Some(old) = map.remove(key) {
            *total -= old.data.len();
        }
        *total += data.len();
        let now = Instant::now();
        map.insert(key.to_string(), CachedPage { data, mtime, last_access: now, created: now });
        if *total > CACHE_MAX_BYTES {
            let mut order: Vec<(String, Instant)> = map.iter().map(|(k, v)| (k.clone(), v.last_access)).collect();
            order.sort_by_key(|(_, t)| *t);
            for (k, _) in order {
                if *total as f64 <= CACHE_MAX_BYTES as f64 * 0.85 {
                    break;
                }
                if let Some(e) = map.remove(&k) {
                    *total -= e.data.len();
                }
            }
        }
    }
}

/// Ghostscript is gs on Unix and gswin64c / gswin32c on Windows.
pub fn gs_candidates() -> &'static [&'static str] {
    if cfg!(windows) { &["gs", "gswin64c", "gswin32c"] } else { &["gs"] }
}

/// Render one page to PNG at `dpi`, scaled to `width` x `height` (-1 keeps the aspect ratio).
pub async fn render_page(file: &str, page: u32, dpi: u32, width: i32, height: i32) -> Result<Vec<u8>, String> {
    let dir = crate::util::temp_dir("filebrowser-pdf").join(crate::util::unique_name("page"));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let out_base = dir.join("page");
    let out_base_s = out_base.to_string_lossy().into_owned();
    let (p, r, w, h) = (page.to_string(), dpi.to_string(), width.to_string(), height.to_string());
    let poppler = run(
        "pdftoppm",
        &["-png", "-f", &p, "-l", &p, "-r", &r, "-scale-to-x", &w, "-scale-to-y", &h, "-singlefile", file, &out_base_s],
        Duration::from_secs(120),
    )
    .await;
    let mut result = match poppler {
        Ok(o) if o.success() => std::fs::read(format!("{}.png", out_base_s)).map_err(|e| e.to_string()),
        Ok(o) => Err(format!("pdftoppm exited with {:?}: {}", o.status, o.stderr_str().trim())),
        Err(e) => Err(format!("pdftoppm unavailable: {}", e)),
    };
    if result.as_ref().map(|d| d.is_empty()).unwrap_or(true) {
        crate::info!("ℹ️ pdftoppm failed ({}), using Ghostscript", result.as_ref().err().cloned().unwrap_or_default());
        let gs_out = format!("{}-gs.png", out_base_s);
        let mut args: Vec<String> = vec![
            "-q".into(), "-dSAFER".into(), "-dBATCH".into(), "-dNOPAUSE".into(), "-sDEVICE=png16m".into(),
            format!("-r{}", dpi), format!("-dFirstPage={}", page), format!("-dLastPage={}", page),
        ];
        if width > 0 && height > 0 {
            args.extend([format!("-g{}x{}", width, height), "-dPDFFitPage".into()]);
        }
        args.extend([format!("-sOutputFile={}", gs_out), file.to_string()]);
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        result = match run_first(gs_candidates(), &refs, Duration::from_secs(120)).await {
            Ok(o) if o.success() => std::fs::read(&gs_out).map_err(|e| e.to_string()),
            Ok(o) => Err(format!("Ghostscript failed: {}", o.stdout_str().trim())),
            Err(e) => Err(format!("No PDF renderer available (pdftoppm, gs): {}", e)),
        };
    }
    let _ = std::fs::remove_dir_all(&dir);
    match result {
        Ok(d) if !d.is_empty() => Ok(d),
        Ok(_) => Err("PDF conversion returned empty result".into()),
        Err(e) => Err(e),
    }
}

/// Number of pages: parsed in-process, with pdfinfo as the fallback.
pub async fn page_count(file: &str) -> Result<u32, String> {
    let f = file.to_string();
    let parsed = tokio::task::spawn_blocking(move || lopdf::Document::load(&f).map(|d| d.get_pages().len() as u32))
        .await
        .map_err(|e| e.to_string())?;
    match parsed {
        Ok(n) if n > 0 => Ok(n),
        other => pdfinfo_pages(file).await.map_err(|e| format!("{} ({:?})", e, other.err().map(|e| e.to_string()))),
    }
}

async fn pdfinfo_pages(file: &str) -> Result<u32, String> {
    let out = run("pdfinfo", &[file], Duration::from_secs(60)).await.map_err(|e| e.to_string())?;
    if !out.success() {
        return Err(out.stderr_str());
    }
    let re = regex::Regex::new(r"Pages:\s*(\d+)").unwrap();
    re.captures(&out.stdout_str()).and_then(|c| c[1].parse().ok()).ok_or_else(|| "Could not parse PDF info".to_string())
}

// GET /api/pdf-info
pub async fn info(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let Some(requested) = ctx.q_nonempty("path") else {
        return text(400, "File path is required");
    };
    let base = app.base_dir();
    let file = jsutil::join(&[&base, requested]);
    if !file.starts_with(&base) {
        return text(403, "Forbidden");
    }
    match run("pdfinfo", &[&file], Duration::from_secs(60)).await {
        Ok(out) if out.success() => {
            let re = regex::Regex::new(r"Pages:\s*(\d+)").unwrap();
            match re.captures(&out.stdout_str()).and_then(|c| c[1].parse::<u64>().ok()) {
                Some(n) => json(&json!({ "pages": n })),
                None => text(500, "Could not parse PDF info"),
            }
        }
        Ok(out) => {
            crate::error!(" ❌ PDF info error: {}", out.stderr_str());
            text(500, "Failed to get PDF info")
        }
        Err(e) => {
            crate::error!(" ❌ PDF info error: {}", e);
            text(500, "Failed to get PDF info")
        }
    }
}

// GET /pdf-preview
pub async fn preview(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let Some(requested) = ctx.q_nonempty("path") else {
        return text(400, "File path is required");
    };
    let page = ctx.q("page").and_then(jsutil::parse_int).filter(|&p| p != 0).unwrap_or(1);
    let base = app.base_dir();
    let file = jsutil::join(&[&base, requested]);
    if !file.starts_with(&base) {
        return text(403, "Forbidden");
    }
    if jsutil::ext_lower(&file) != ".pdf" {
        return text(400, "Not a PDF file");
    }
    let mtime = match std::fs::metadata(&file).and_then(|m| m.modified()) {
        Ok(t) => epoch_ms(t),
        Err(e) => return text(500, format!("PDF conversion error: {}", e)),
    };
    let key = format!("{}:{}", file, page);
    let png = |data: Bytes, tag: &str| with_header(bytes_resp(200, "image/png", data), "x-pdf-cache", tag);
    if let Some(data) = app.pdf.get(&key, mtime) {
        return png(data, "HIT");
    }
    let waited = !app.pdf.inflight.is_empty();
    let _guard = app.pdf.inflight.lock(&key).await;
    if let Some(data) = app.pdf.get(&key, mtime) {
        return png(data, if waited { "WAIT-HIT" } else { "HIT" });
    }
    if page < 1 {
        return text(500, "PDF conversion error: Invalid page number");
    }
    match render_page(&file, page as u32, 120, 900, -1).await {
        Ok(data) => {
            let data = Bytes::from(data);
            app.pdf.set(&key, data.clone(), mtime);
            png(data, "MISS")
        }
        Err(e) => {
            crate::error!(" ❌ PDF conversion error: {}", e);
            text(500, format!("PDF conversion error: {}", e))
        }
    }
}

// GET /api/validate-pdf (Ghostscript reads the whole file and reports damage)
pub async fn validate(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let Some(requested) = ctx.q_nonempty("path") else {
        return json_status(400, &json!({ "error": "File path is required" }));
    };
    let decoded = jsutil::decode_or_raw(requested);
    let base = app.base_dir();
    let file = jsutil::join(&[&base, &decoded]);
    if !file.starts_with(&base) {
        return json_status(403, &json!({ "error": "Forbidden" }));
    }
    if jsutil::ext_lower(&file) != ".pdf" {
        return json_status(400, &json!({ "error": "Not a PDF file" }));
    }
    let Ok(meta) = std::fs::metadata(&file) else {
        return json_status(404, &json!({ "valid": false, "error": "File not found", "diagnosis": "The PDF file does not exist at the specified path." }));
    };
    let size_mb = format!("{:.2}", meta.len() as f64 / 1024.0 / 1024.0);
    let args = ["-dNODISPLAY", "-dBATCH", "-dNOPAUSE", "-sDEVICE=nullpage", file.as_str()];
    let out = match run_first(gs_candidates(), &args, Duration::from_secs(25)).await {
        Ok(o) if o.timed_out => {
            return json(&json!({ "valid": false, "error": "Validation timeout",
                "diagnosis": "PDF validation took too long. The file may be extremely large or corrupted." }));
        }
        Ok(o) => format!("{}{}", o.stdout_str(), o.stderr_str()),
        Err(e) => e.to_string(),
    };
    json(&diagnose(&out, &size_mb))
}

/// Turn Ghostscript's output into a verdict for the user.
pub fn diagnose(output: &str, size_mb: &str) -> Value {
    let mut issues: Vec<&str> = Vec::new();
    let mut severity = "ok";
    let has = |s: &str| output.contains(s);
    if has("Catalog dictionary not located") {
        issues.push("Missing catalog dictionary - PDF structure is severely damaged");
        severity = "critical";
    }
    if has("no startxref token found") {
        issues.push("Missing cross-reference table - file may be truncated or incomplete");
        severity = "critical";
    }
    if has("xref table was repaired") {
        issues.push("Cross-reference table was corrupted and required repair");
        if severity != "critical" {
            severity = "warning";
        }
    }
    if has("Couldn't initialise file") {
        issues.push("PDF cannot be initialized - file is unreadable");
        severity = "critical";
    }
    if has("Error: Cannot find a 'startxref'") {
        issues.push("Cannot locate PDF start marker - file structure is broken");
        severity = "critical";
    }
    if has("This file had errors") && severity != "critical" {
        severity = "warning";
    }
    if has("encrypted") || has("password") {
        issues.push("PDF is password protected or encrypted");
        severity = "protected";
    }
    if has("No pages will be processed") {
        issues.push("No readable pages found in the PDF");
        severity = "critical";
    }
    let (diagnosis, recommendation) = match severity {
        "critical" => (
            "This PDF is severely corrupted and cannot be displayed.",
            "Re-download the file from the original source. The current file appears to be incomplete or damaged during transfer.",
        ),
        "protected" => ("This PDF is password protected.", "You need the password to view this file, or obtain an unprotected version."),
        "warning" => ("This PDF has minor issues but may still be viewable.", "Try opening the file anyway. If it fails, consider re-downloading."),
        _ => ("PDF structure appears valid.", ""),
    };
    json!({
        "valid": severity == "ok" || severity == "warning",
        "severity": severity,
        "issues": issues,
        "diagnosis": diagnosis,
        "recommendation": recommendation,
        "fileSize": format!("{} MB", size_mb),
        "gsOutput": jsutil::js_prefix(output, 1000),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ghostscript_verdicts() {
        assert_eq!(diagnose("", "1.00")["severity"], "ok");
        let v = diagnose("   **** Error: xref table was repaired", "1.00");
        assert_eq!(v["severity"], "warning");
        assert_eq!(v["valid"], true);
        let v = diagnose("no startxref token found\nThis file had errors", "1.00");
        assert_eq!(v["severity"], "critical");
        assert_eq!(v["valid"], false);
        assert_eq!(diagnose("file requires a password", "1.00")["severity"], "protected");
    }
}
