//! Disk cache under ~/.browser/cache, file-compatible with cache.js: one JSON file per entry
//! ({data, timestamp, sourceFile, mtime}), keyed by md5("path:operation:extra"), valid while the
//! source file is not newer than the entry and the entry is younger than maxAge.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use md5::{Digest, Md5};
use serde_json::{json, Value};

use crate::jsutil::{epoch_ms, iso, now_ms};

pub struct FileCache {
    pub dir: PathBuf,
    max_age_ms: i64,
    max_size: u64,
    initialized: bool,
}

const SUBDIRS: [&str; 5] = ["comic-lists", "archive-contents", "pdf-info", "thumbnails", "directory-listings"];

pub fn home_dir() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

impl FileCache {
    pub fn new(max_age_ms: i64, max_size: u64) -> Self {
        let dir = home_dir().join(".browser").join("cache");
        let mut initialized = true;
        for sub in SUBDIRS {
            if let Err(e) = std::fs::create_dir_all(dir.join(sub)) {
                crate::error!(" ❌ Cache initialization failed: {}", e);
                initialized = false;
                break;
            }
        }
        if initialized {
            crate::info!(" ✅ Cache system initialized at {}", dir.display());
        }
        FileCache { dir, max_age_ms, max_size, initialized }
    }

    pub fn generate_key(&self, file_path: &str, operation: &str, extra: &str) -> String {
        hex::encode(Md5::digest(format!("{}:{}:{}", file_path, operation, extra).as_bytes()))
    }

    fn entry_path(&self, category: &str, key: &str) -> PathBuf {
        self.dir.join(category).join(format!("{}.json", key))
    }

    fn is_valid(&self, cache_file: &Path, source: &str) -> bool {
        let (Ok(c), Ok(s)) = (std::fs::metadata(cache_file), std::fs::metadata(source)) else {
            return false;
        };
        let (Ok(cm), Ok(sm)) = (c.modified(), s.modified()) else { return false };
        let (cm, sm) = (epoch_ms(cm), epoch_ms(sm));
        // Allow 1 second of filesystem timing slack
        if sm > cm + 1000 {
            return false;
        }
        now_ms() - cm <= self.max_age_ms
    }

    pub fn get(&self, category: &str, key: &str, source: Option<&str>) -> Option<Value> {
        if !self.initialized {
            return None;
        }
        let file = self.entry_path(category, key);
        if let Some(src) = source {
            if !self.is_valid(&file, src) {
                return None;
            }
        }
        let text = std::fs::read_to_string(&file).ok()?;
        let parsed: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => {
                crate::error!(" ❌ Cache read error: {}", e);
                return None;
            }
        };
        // Touch for LRU (mtime stays current so the entry is not invalidated)
        let _ = filetime_now(&file);
        crate::debug!(" 📋 Cache HIT: {}/{}", category, key);
        parsed.get("data").cloned()
    }

    pub fn set(&self, category: &str, key: &str, data: &Value, source: Option<&str>) -> bool {
        if !self.initialized {
            return false;
        }
        let file = self.entry_path(category, key);
        let mtime = source
            .and_then(|s| std::fs::metadata(s).ok())
            .and_then(|m| m.modified().ok())
            .map(|t| Value::String(iso(t)))
            .unwrap_or(Value::Null);
        let entry = json!({ "data": data, "timestamp": now_ms(), "sourceFile": source, "mtime": mtime });
        match std::fs::write(&file, serde_json::to_string_pretty(&entry).unwrap_or_default()) {
            Ok(()) => {
                crate::debug!(" 💾 Cache SET: {}/{}", category, key);
                self.cleanup();
                true
            }
            Err(e) => {
                crate::error!(" ❌ Cache write error: {}", e);
                false
            }
        }
    }

    /// Totals per category: {totalFiles, totalSize, categories: {name: {files, size}}}.
    pub fn stats(&self) -> Result<Value, String> {
        if !self.initialized {
            return Err("Cache not initialized".into());
        }
        let mut total_files = 0u64;
        let mut total_size = 0u64;
        let mut categories = serde_json::Map::new();
        let read = std::fs::read_dir(&self.dir).map_err(|e| e.to_string())?;
        let mut names: Vec<_> = read.filter_map(|e| e.ok()).collect();
        names.sort_by_key(|e| e.file_name());
        for entry in names {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let mut files = 0u64;
            let mut size = 0u64;
            if let Ok(rd) = std::fs::read_dir(&path) {
                for f in rd.flatten() {
                    files += 1;
                    size += f.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
            total_files += files;
            total_size += size;
            categories.insert(entry.file_name().to_string_lossy().into_owned(), json!({ "files": files, "size": size }));
        }
        Ok(json!({ "totalFiles": total_files, "totalSize": total_size, "categories": categories }))
    }

    /// Remove least recently used entries once the cache passes 80% of its size limit.
    fn cleanup(&self) {
        let Ok(stats) = self.stats() else { return };
        let total = stats["totalSize"].as_u64().unwrap_or(0);
        if (total as f64) < self.max_size as f64 * 0.8 {
            return;
        }
        let mut all: Vec<(PathBuf, SystemTime, u64)> = Vec::new();
        for cat in SUBDIRS.iter().map(|s| self.dir.join(s)).chain(std::iter::empty()) {
            if let Ok(rd) = std::fs::read_dir(cat) {
                for f in rd.flatten() {
                    if let Ok(m) = f.metadata() {
                        let at = m.accessed().or_else(|_| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
                        all.push((f.path(), at, m.len()));
                    }
                }
            }
        }
        all.sort_by_key(|(_, at, _)| *at);
        let target = self.max_size as f64 * 0.7;
        let mut removed = 0u64;
        for (path, _, size) in all {
            if (total - removed) as f64 <= target {
                break;
            }
            if std::fs::remove_file(&path).is_ok() {
                removed += size;
            }
        }
    }

    pub fn clear(&self) -> bool {
        if !self.initialized {
            return false;
        }
        let Ok(rd) = std::fs::read_dir(&self.dir) else { return false };
        let mut removed = 0;
        for cat in rd.flatten() {
            if !cat.path().is_dir() {
                continue;
            }
            if let Ok(files) = std::fs::read_dir(cat.path()) {
                for f in files.flatten() {
                    if f.path().is_file() && std::fs::remove_file(f.path()).is_ok() {
                        removed += 1;
                    }
                }
            }
        }
        crate::info!(" 🗑️ Cache cleared: {} files removed", removed);
        true
    }
}

fn filetime_now(path: &Path) -> std::io::Result<()> {
    let f = std::fs::OpenOptions::new().write(true).open(path)?;
    let now = SystemTime::now();
    f.set_times(std::fs::FileTimes::new().set_accessed(now).set_modified(now))
}

/// GET /api/cache/stats and POST /api/cache/clear
pub mod routes {
    use crate::app::{json, json_status, AppRef};
    use axum::extract::State;
    use axum::response::Response;
    use serde_json::{json, Value};

    fn mb(v: u64) -> String {
        format!("{:.1} MB", v as f64 / 1024.0 / 1024.0)
    }

    pub async fn stats(State(app): State<AppRef>) -> Response {
        match app.cache.stats() {
            Ok(stats) => {
                let cats: Vec<Value> = stats["categories"]
                    .as_object()
                    .map(|m| {
                        m.iter()
                            .map(|(name, c)| {
                                let size = c["size"].as_u64().unwrap_or(0);
                                json!({ "name": name, "files": c["files"], "size": size, "sizeFormatted": mb(size) })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                json(&json!({
                    "totalFiles": stats["totalFiles"],
                    "totalSize": stats["totalSize"],
                    "categories": cats,
                    "totalSizeFormatted": mb(stats["totalSize"].as_u64().unwrap_or(0)),
                }))
            }
            Err(e) => json(&json!({ "error": e, "totalSizeFormatted": "NaN MB", "categories": [] })),
        }
    }

    pub async fn clear(State(app): State<AppRef>) -> Response {
        if app.cache.clear() {
            json(&json!({ "message": "Cache cleared successfully" }))
        } else {
            json_status(500, &json!({ "error": "Failed to clear cache" }))
        }
    }
}
