//! Annotations (comment, stars, color) and video bookmarks (lib/annotation-handlers.js).
//! Sparse storage: one JSON file per annotated file in <root>/.browser/annotations/, holding its
//! originalPath; the legacy per-directory files and the single annotations.json are still read.

use std::path::{Path, PathBuf};

use axum::extract::State;
use axum::response::Response;
use md5::{Digest, Md5};
use serde_json::{json, Map, Value};

use crate::app::{json, json_status, App, AppRef, Ctx};
use crate::jsutil::{self, js_prefix, now_iso, truthy};

type Obj = Map<String, Value>;

fn browser_dir(app: &App) -> PathBuf {
    let dir = Path::new(&app.base_dir()).join(".browser");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn annotations_dir(app: &App) -> PathBuf {
    let dir = browser_dir(app).join("annotations");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Replace every UTF-16 code unit outside `keep` with '_' (JavaScript's /[^...]/g on a string).
fn sanitize(s: &str, keep: impl Fn(char) -> bool) -> String {
    s.chars()
        .flat_map(|c| {
            let n = c.len_utf16();
            if keep(c) { vec![c] } else { vec!['_'; n] }
        })
        .collect()
}

fn md5_hex(s: &str) -> String {
    hex::encode(Md5::digest(s.as_bytes()))
}

fn sparse_path(app: &App, file_path: &str) -> PathBuf {
    let mut safe = sanitize(file_path, |c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    if safe.len() > 200 {
        let ext = jsutil::extname(file_path);
        let base = jsutil::basename(file_path);
        let stem = if !ext.is_empty() && base.ends_with(&ext) && base != ext { &base[..base.len() - ext.len()] } else { &base[..] };
        safe = format!("{}_{}{}", js_prefix(stem, 50), md5_hex(file_path), ext);
    }
    annotations_dir(app).join(format!("{}.json", safe))
}

fn legacy_dir_path(app: &App, file_path: &str) -> PathBuf {
    let dir = jsutil::dirname(file_path);
    let mut safe = sanitize(&dir, |c| c.is_ascii_alphanumeric());
    if safe.is_empty() {
        safe = "root".into();
    }
    if safe.len() > 100 {
        safe = format!("{}_{}", &safe[..50], md5_hex(&dir));
    }
    annotations_dir(app).join(format!("{}.json", safe))
}

fn read_obj(path: &Path) -> Option<Obj> {
    let text = std::fs::read_to_string(path).ok()?;
    if text.trim().is_empty() {
        return Some(Obj::new());
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(m)) => Some(m),
        Ok(_) => Some(Obj::new()),
        Err(e) => {
            crate::error!(" ❌ Error reading annotation file {}: {}", path.display(), e);
            None
        }
    }
}

fn write_obj(path: &Path, obj: &Obj) -> bool {
    match std::fs::write(path, serde_json::to_string_pretty(obj).unwrap_or_default()) {
        Ok(()) => true,
        Err(e) => {
            crate::error!(" ❌ Error saving annotations: {}", e);
            false
        }
    }
}

fn load_sparse(app: &App, file_path: &str) -> Option<Obj> {
    let a = read_obj(&sparse_path(app, file_path))?;
    (a.get("originalPath").and_then(Value::as_str) == Some(file_path)).then_some(a)
}

fn is_empty_annotation(a: &Obj) -> bool {
    let bookmarks_empty = a.get("bookmarks").and_then(Value::as_array).map(|b| b.is_empty()).unwrap_or(true);
    !truthy(a.get("comment")) && !truthy(a.get("stars")) && !truthy(a.get("color")) && bookmarks_empty
}

/// Save one annotation file; an empty annotation deletes it.
fn save_sparse(app: &App, file_path: &str, mut a: Obj) -> bool {
    let file = sparse_path(app, file_path);
    if is_empty_annotation(&a) {
        let _ = std::fs::remove_file(&file);
        return true;
    }
    a.insert("originalPath".into(), Value::String(file_path.into()));
    a.insert("lastModified".into(), Value::String(now_iso()));
    write_obj(&file, &a)
}

fn load_legacy(app: &App) -> Obj {
    read_obj(&browser_dir(app).join("annotations.json")).unwrap_or_default()
}

fn load_dir_annotations(app: &App, file_path: &str) -> Obj {
    read_obj(&legacy_dir_path(app, file_path)).unwrap_or_default()
}

/// Sparse first, then the legacy per-directory file, then the legacy single file.
pub fn load_for_file(app: &App, file_path: &str) -> Obj {
    if let Some(a) = load_sparse(app, file_path) {
        return a;
    }
    if let Some(Value::Object(a)) = load_dir_annotations(app, file_path).get(file_path) {
        return a.clone();
    }
    match load_legacy(app).get(file_path) {
        Some(Value::Object(a)) => a.clone(),
        _ => Obj::new(),
    }
}

fn annotation_files(app: &App) -> Vec<PathBuf> {
    let dir = annotations_dir(app);
    crate::browse::read_dir_js(&dir.to_string_lossy())
        .map(|entries| {
            entries
                .into_iter()
                .filter(|(n, _)| n.ends_with(".json"))
                .map(|(n, _)| dir.join(n))
                .collect()
        })
        .unwrap_or_default()
}

fn load_all(app: &App) -> Obj {
    let mut all = load_legacy(app);
    for file in annotation_files(app) {
        let Some(a) = read_obj(&file) else { continue };
        if let Some(orig) = a.get("originalPath").and_then(Value::as_str).filter(|s| !s.is_empty()) {
            all.insert(orig.to_string(), Value::Object(a.clone()));
        } else {
            for (k, v) in a {
                if v.is_object() {
                    all.insert(k, v);
                }
            }
        }
    }
    all
}

fn save_annotation(app: &App, file_path: &str, update: Obj) -> bool {
    let mut merged = load_for_file(app, file_path);
    for (k, v) in update {
        merged.insert(k, v);
    }
    for k in ["comment", "stars", "color"] {
        if !truthy(merged.get(k)) {
            merged.shift_remove(k);
        }
    }
    if merged.get("bookmarks").and_then(Value::as_array).map(|b| b.is_empty()).unwrap_or(true) {
        merged.shift_remove("bookmarks");
    }
    save_sparse(app, file_path, merged)
}

fn delete_annotation(app: &App, file_path: &str) -> bool {
    let _ = std::fs::remove_file(sparse_path(app, file_path));
    let mut dir = load_dir_annotations(app, file_path);
    if dir.shift_remove(file_path).is_some() {
        write_obj(&legacy_dir_path(app, file_path), &dir);
    }
    true
}

/// Move an annotation from one path to another (after a rename or move).
pub fn rename_annotation(app: &App, old_path: &str, new_path: &str) -> bool {
    let mut a = load_for_file(app, old_path);
    if a.is_empty() {
        return true;
    }
    delete_annotation(app, old_path);
    a.insert("lastModified".into(), Value::String(now_iso()));
    save_sparse(app, new_path, a)
}

fn migrate(app: &App) -> Value {
    let (mut migrated, mut failed, mut skipped) = (0u64, 0u64, 0u64);
    let mut errors: Vec<String> = Vec::new();
    let mut all = load_legacy(app);
    for file in annotation_files(app) {
        let Some(content) = read_obj(&file) else { continue };
        if truthy(content.get("originalPath")) {
            continue;
        }
        for (k, v) in content {
            if v.is_object() && !truthy(v.get("originalPath")) {
                all.insert(k, v);
            }
        }
    }
    crate::info!(" 📦 Found {} legacy annotations to migrate", all.len());
    for (file_path, annotation) in all {
        let Value::Object(a) = annotation else { continue };
        if truthy(a.get("originalPath")) {
            skipped += 1;
            continue;
        }
        // As before: the existence check is relative to the working directory
        if !Path::new(&file_path).exists() {
            skipped += 1;
            continue;
        }
        if load_sparse(app, &file_path).is_some() {
            skipped += 1;
            continue;
        }
        if save_sparse(app, &file_path, a) {
            migrated += 1;
        } else {
            failed += 1;
            errors.push(format!("Failed to save: {}", file_path));
        }
    }
    json!({ "migrated": migrated, "failed": failed, "skipped": skipped, "errors": errors })
}

// ---------------------------------------------------------------------------------------------
// Routes

pub async fn get_annotations(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let file_path = ctx.q_nonempty("path").map(String::from);
    let is_dir = ctx.q("directory") == Some("true");
    let app2 = app.clone();
    let out = tokio::task::spawn_blocking(move || match file_path {
        Some(fp) if is_dir => {
            let prefix = format!("{}/", fp);
            let mut found = Obj::new();
            for (k, v) in load_all(&app2) {
                if let Some(rest) = k.strip_prefix(&prefix) {
                    if !rest.contains('/') {
                        found.insert(k, v);
                    }
                }
            }
            json!({ "annotations": found })
        }
        Some(fp) => Value::Object(load_for_file(&app2, &fp)),
        None => Value::Object(load_all(&app2)),
    })
    .await;
    match out {
        Ok(v) => json(&v),
        Err(e) => json_status(500, &json!({ "error": e.to_string() })),
    }
}

pub async fn post_annotations(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let Some(file_path) = ctx.b("filePath").filter(|v| truthy(Some(v))).map(value_string) else {
        return json_status(400, &json!({ "error": "File path is required" }));
    };
    let mut a = Obj::new();
    if let Some(comment) = ctx.b("comment") {
        match comment {
            Value::String(s) => {
                if !s.trim().is_empty() {
                    a.insert("comment".into(), Value::String(s.trim().into()));
                }
            }
            Value::Null => {
                return json_status(500, &json!({ "error": "Cannot read properties of null (reading 'trim')" }));
            }
            other => {
                a.insert("comment".into(), other.clone());
            }
        }
    }
    if let Some(stars) = ctx.b("stars") {
        let zero = stars.as_f64() == Some(0.0);
        if !zero && !stars.is_null() {
            let parsed = jsutil::parse_int(&value_string(stars));
            a.insert("stars".into(), parsed.map(|n| json!(n.clamp(1, 5))).unwrap_or(Value::Null));
        }
    }
    if let Some(color) = ctx.b("color") {
        if !color.is_null() && color.as_str() != Some("") {
            a.insert("color".into(), color.clone());
        }
    }
    let app2 = app.clone();
    let out = tokio::task::spawn_blocking(move || {
        save_annotation(&app2, &file_path, a).then(|| load_for_file(&app2, &file_path))
    })
    .await
    .ok()
    .flatten();
    match out {
        Some(saved) => json(&json!({ "success": true, "annotation": saved })),
        None => json_status(500, &json!({ "error": "Failed to save annotation" })),
    }
}

pub async fn delete_annotations(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let Some(file_path) = ctx.q_nonempty("path") else {
        return json_status(400, &json!({ "error": "File path is required" }));
    };
    delete_annotation(&app, file_path);
    json(&json!({ "success": true }))
}

/// Type of a file for the annotation search filter.
fn file_type(ext: &str, file_name: &str) -> &'static str {
    const CODE: &[&str] = &[
        "js", "html", "css", "json", "py", "java", "c", "cpp", "go", "rs", "xml", "yaml", "yml", "ini", "conf", "log", "sh", "bat", "ps1",
        "sql", "php", "rb", "swift", "kt", "dart", "r", "scala", "clj", "elm", "vue", "jsx", "tsx", "ts", "less", "scss", "sass", "styl",
        "svelte", "astro",
    ];
    match ext {
        "pdf" => "pdf",
        "cbz" | "cbr" => "comic",
        "jpg" | "jpeg" | "jfif" | "pjpeg" | "pjp" | "png" | "gif" | "webp" => "image",
        "mp4" | "avi" | "mov" | "mkv" => "video",
        "mp3" | "wav" | "flac" | "ogg" => "audio",
        e if CODE.contains(&e) => "code",
        "ipynb" => "notebook",
        "txt" | "md" | "rtf" | "doc" | "docx" | "odt" => "text",
        "csv" | "xlsx" | "xls" | "ods" => "table",
        "pptx" | "ppt" | "odp" => "presentation",
        "srt" => "subtitle",
        "epub" => "ebook",
        "zip" | "rar" | "tar" | "tgz" | "7z" => "archive",
        _ if file_name.ends_with(".tar.gz") => "archive",
        _ => "text",
    }
}

pub async fn search_annotations(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let q = |k: &str| ctx.q_nonempty(k).map(String::from);
    let (query, color, file_type_q, directory) = (q("query"), q("color"), q("fileType"), q("directory"));
    let flag = |k: &str| ctx.q(k) == Some("true");
    let (has_comment, has_stars, has_color, has_bookmarks, exact) =
        (flag("hasComment"), flag("hasStars"), flag("hasColor"), flag("hasBookmarks"), flag("exactDir"));
    let base = app.base_dir();
    let app2 = app.clone();
    let results = tokio::task::spawn_blocking(move || {
        let full_dir = directory.as_ref().map(|d| if d.starts_with('/') { d.clone() } else { jsutil::join(&[&base, d]) });
        let mut results: Vec<(Option<i64>, Value)> = Vec::new();
        for (file_path, annotation) in load_all(&app2) {
            let Value::Object(a) = annotation else { continue };
            let mut matches = true;
            if let (Some(dir), Some(full)) = (&directory, &full_dir) {
                if exact {
                    let file_dir = jsutil::dirname(&file_path);
                    if !(file_dir == *dir || file_dir.ends_with(&format!("/{}", dir)) || file_dir == *full) {
                        matches = false;
                    }
                } else if !(file_path.contains(&format!("/{}/", dir)) || file_path.starts_with(&format!("{}/", dir)) || file_path.starts_with(&format!("{}/", full))) {
                    matches = false;
                }
            }
            let comment = a.get("comment").filter(|v| truthy(Some(v)));
            if let Some(q) = &query {
                match comment {
                    Some(c) => matches = matches && value_string(c).to_lowercase().contains(&q.to_lowercase()),
                    None => matches = false,
                }
            }
            if has_comment && comment.is_none() {
                matches = false;
            }
            if has_stars && !truthy(a.get("stars")) {
                matches = false;
            }
            if has_color && !truthy(a.get("color")) {
                matches = false;
            }
            if has_bookmarks && a.get("bookmarks").and_then(Value::as_array).map(|b| b.is_empty()).unwrap_or(true) {
                matches = false;
            }
            if let Some(c) = &color {
                if a.get("color").and_then(Value::as_str) != Some(c.as_str()) {
                    matches = false;
                }
            }
            if let Some(ft) = file_type_q.as_deref().filter(|f| *f != "all") {
                let name = file_path.rsplit('/').next().unwrap_or("");
                let ext = name.rsplit('.').next().unwrap_or("");
                if file_type(ext, name) != ft {
                    matches = false;
                }
            }
            if matches {
                let modified = a
                    .get("lastModified")
                    .and_then(Value::as_str)
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|d| d.timestamp_millis());
                let mut entry = Obj::new();
                entry.insert("filePath".into(), Value::String(file_path.clone()));
                for (k, v) in a {
                    entry.insert(k, v);
                }
                results.push((modified, Value::Object(entry)));
            }
        }
        // Newest first; entries without a date keep their order at the end
        results.sort_by_key(|(m, _)| std::cmp::Reverse(m.unwrap_or(i64::MIN)));
        results.into_iter().map(|(_, v)| v).collect::<Vec<_>>()
    })
    .await
    .unwrap_or_default();
    json(&Value::Array(results))
}

// ---------------------------------------------------------------------------------------------
// Bookmarks

fn value_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn get_bookmarks(app: &App, file_path: &str) -> Vec<Value> {
    load_for_file(app, file_path).get("bookmarks").and_then(Value::as_array).cloned().unwrap_or_default()
}

fn save_bookmarks(app: &App, file_path: &str, bookmarks: Vec<Value>) -> bool {
    let mut a = load_for_file(app, file_path);
    a.insert("bookmarks".into(), Value::Array(bookmarks));
    a.insert("lastModified".into(), Value::String(now_iso()));
    if a.get("bookmarks").and_then(Value::as_array).map(|b| b.is_empty()).unwrap_or(true) {
        a.shift_remove("bookmarks");
    }
    save_sparse(app, file_path, a)
}

fn position(b: &Value) -> f64 {
    b.get("position").and_then(Value::as_f64).filter(|f| !f.is_nan()).unwrap_or(f64::INFINITY)
}

pub async fn get_bookmarks_api(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let Some(file_path) = ctx.q_nonempty("path") else {
        return json_status(400, &json!({ "error": "File path is required" }));
    };
    json(&Value::Array(get_bookmarks(&app, file_path)))
}

pub async fn post_bookmark_api(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let (Some(file_path), Some(name)) = (
        ctx.b("filePath").filter(|v| truthy(Some(v))).map(value_string),
        ctx.b("name").filter(|v| truthy(Some(v))).cloned(),
    ) else {
        return json_status(400, &json!({ "error": "File path and bookmark name are required" }));
    };
    let mut bookmark = Obj::new();
    bookmark.insert("name".into(), name.clone());
    if let Some(p) = ctx.b("position") {
        bookmark.insert("position".into(), p.clone());
    }
    let mut bookmarks = get_bookmarks(&app, &file_path);
    match bookmarks.iter().position(|b| b.get("name") == Some(&name)) {
        Some(i) => bookmarks[i] = Value::Object(bookmark),
        None => bookmarks.push(Value::Object(bookmark)),
    }
    bookmarks.sort_by(|a, b| position(a).total_cmp(&position(b)));
    if save_bookmarks(&app, &file_path, bookmarks) {
        json(&json!({ "success": true, "bookmarks": get_bookmarks(&app, &file_path) }))
    } else {
        json_status(500, &json!({ "error": "Failed to save bookmark" }))
    }
}

pub async fn delete_bookmark_api(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let (Some(file_path), Some(name)) = (
        ctx.b("filePath").filter(|v| truthy(Some(v))).map(value_string),
        ctx.b("name").filter(|v| truthy(Some(v))).cloned(),
    ) else {
        return json_status(400, &json!({ "error": "File path and bookmark name are required" }));
    };
    let bookmarks: Vec<Value> = get_bookmarks(&app, &file_path).into_iter().filter(|b| b.get("name") != Some(&name)).collect();
    if save_bookmarks(&app, &file_path, bookmarks) {
        json(&json!({ "success": true, "bookmarks": get_bookmarks(&app, &file_path) }))
    } else {
        json_status(500, &json!({ "error": "Failed to delete bookmark" }))
    }
}

pub async fn rename_bookmark_api(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let get = |k: &str| ctx.b(k).filter(|v| truthy(Some(v))).cloned();
    let (Some(file_path), Some(old_name), Some(new_name)) = (get("path").map(|v| value_string(&v)), get("oldName"), get("newName")) else {
        return json_status(400, &json!({ "error": "File path, old name and new name are required" }));
    };
    let mut bookmarks = get_bookmarks(&app, &file_path);
    let ok = match bookmarks.iter_mut().find(|b| b.get("name") == Some(&old_name)) {
        Some(b) => {
            b["name"] = new_name;
            save_bookmarks(&app, &file_path, bookmarks)
        }
        None => false,
    };
    if ok {
        json(&json!({ "success": true, "bookmarks": get_bookmarks(&app, &file_path) }))
    } else {
        json_status(500, &json!({ "error": "Failed to rename bookmark" }))
    }
}

pub async fn migrate_api(State(app): State<AppRef>) -> Response {
    let r = migrate(&app);
    let mut body = Obj::new();
    body.insert("success".into(), json!(true));
    body.insert(
        "message".into(),
        json!(format!("Migration complete: {} migrated, {} skipped, {} failed", r["migrated"], r["skipped"], r["failed"])),
    );
    if let Value::Object(m) = r {
        body.extend(m);
    }
    json(&Value::Object(body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_counts_utf16_units() {
        assert_eq!(sanitize("a/b.c-d", |c| c.is_ascii_alphanumeric() || c == '.' || c == '-'), "a_b.c-d");
        assert_eq!(sanitize("x😀", |c| c.is_ascii_alphanumeric()), "x__");
    }

    #[test]
    fn search_file_types() {
        assert_eq!(file_type("pdf", "a.pdf"), "pdf");
        assert_eq!(file_type("gz", "a.tar.gz"), "archive");
        assert_eq!(file_type("rs", "main.rs"), "code");
        assert_eq!(file_type("README", "README"), "text");
    }
}
