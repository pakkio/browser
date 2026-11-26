//! Environment, served root and mime types (lib/config.js).

use std::path::{Path, PathBuf};

use crate::jsutil;

/// Load .env files without overriding variables already set: ../.env first, then the app's own
/// .env, then the per-user %LOCALAPPDATA%/FileBrowser/.env (survives reinstalls).
pub fn load_env(app_dir: &Path) {
    let mut files = vec![app_dir.join("..").join(".env"), app_dir.join(".env")];
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        files.push(PathBuf::from(local).join("FileBrowser").join(".env"));
    }
    for f in files {
        let _ = dotenvy::from_path(&f);
    }
}

/// Folder holding public/: FILEBROWSER_APP_DIR, else the first ancestor of the executable that has
/// public/index.html (the repository during development, the install folder once installed),
/// else the current directory.
pub fn find_app_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("FILEBROWSER_APP_DIR") {
        return PathBuf::from(dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.parent().map(Path::to_path_buf);
        while let Some(dir) = cur {
            if dir.join("public").join("index.html").is_file() {
                return dir;
            }
            for sub in ["app", "browser"] {
                if dir.join(sub).join("public").join("index.html").is_file() {
                    return dir.join(sub);
                }
            }
            cur = dir.parent().map(Path::to_path_buf);
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn auth_enabled() -> bool {
    let v = std::env::var("AUTH").unwrap_or_else(|_| "FALSE".into()).to_uppercase();
    matches!(v.as_str(), "TRUE" | "YES" | "1")
}

pub fn port() -> u16 {
    std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000)
}

/// On Windows, a WSL/POSIX drive path (/mnt/z, /mnt/z/media) becomes Z:\, Z:\media.
pub fn to_native_path(dir: &str) -> String {
    if cfg!(windows) {
        // A bare drive ("z:") means its root, not the current folder joined with "z:"
        let b = dir.as_bytes();
        if b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
            return format!("{}:\\", dir[..1].to_uppercase());
        }
        let re = regex::Regex::new(r"(?i)^[\\/]mnt[\\/]([a-z])(?:[\\/](.*))?$").unwrap();
        if let Some(c) = re.captures(dir) {
            return format!("{}:\\{}", c[1].to_uppercase(), c.get(2).map(|m| m.as_str()).unwrap_or(""));
        }
    }
    dir.to_string()
}

/// Resolve the served root: absolute, native, symlinks / mapped drives resolved.
pub fn resolve_base_dir(arg: &str) -> String {
    let cwd = std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| ".".into());
    let resolved = jsutil::resolve(&cwd, &to_native_path(arg));
    jsutil::realpath(&resolved).unwrap_or(resolved)
}

/// Switch the served root at runtime. Returns the real path; errors when it is not a directory.
pub fn set_base_dir(app: &crate::app::App, dir: &str) -> Result<String, String> {
    let cwd = std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| ".".into());
    let resolved = jsutil::resolve(&cwd, &to_native_path(dir));
    if !Path::new(&resolved).is_dir() {
        return Err(format!("Not a directory: {}", resolved));
    }
    let real = jsutil::realpath(&resolved).map_err(|e| e.to_string())?;
    app.set_base_dir_raw(real.clone());
    crate::info!("Base directory changed to {}", real);
    Ok(real)
}

pub fn validate_env(auth: bool) -> Vec<String> {
    let mut w = Vec::new();
    let has = |k: &str| std::env::var(k).map(|v| !v.is_empty()).unwrap_or(false);
    if auth {
        if !has("GOOGLE_CLIENT_ID") {
            w.push("AUTH=TRUE but GOOGLE_CLIENT_ID is missing".into());
        }
        if !has("GOOGLE_CLIENT_SECRET") {
            w.push("AUTH=TRUE but GOOGLE_CLIENT_SECRET is missing".into());
        }
    }
    match std::env::var("AI_PROVIDER").as_deref() {
        Ok("openrouter") if !has("OPENROUTER_API_KEY") => w.push("AI_PROVIDER=openrouter but OPENROUTER_API_KEY is missing".into()),
        Ok("lmstudio") if !has("LMSTUDIO_URL") => w.push("AI_PROVIDER=lmstudio but LMSTUDIO_URL is missing".into()),
        _ => {}
    }
    w
}

/// lib/config.js mimeTypes
pub fn mime_type(ext: &str) -> Option<&'static str> {
    Some(match ext {
        ".html" => "text/html",
        ".js" => "text/javascript",
        ".css" => "text/css",
        ".json" => "application/json",
        ".png" => "image/png",
        ".jpg" | ".jpeg" | ".jfif" | ".pjpeg" | ".pjp" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        ".tiff" | ".tif" => "image/tiff",
        ".svg" => "image/svg+xml",
        ".wav" => "audio/wav",
        ".mp3" => "audio/mpeg",
        ".mp4" => "video/mp4",
        ".avi" => "video/x-msvideo",
        ".mov" => "video/quicktime",
        ".mkv" => "video/x-matroska",
        ".webm" => "video/webm",
        ".mpg" | ".mpeg" => "video/mpeg",
        ".wmv" => "video/x-ms-wmv",
        ".woff" => "application/font-woff",
        ".ttf" => "application/font-ttf",
        ".eot" => "application/vnd.ms-fontobject",
        ".otf" => "application/font-otf",
        ".wasm" => "application/wasm",
        ".pdf" => "application/pdf",
        ".cbz" => "application/vnd.comicbook+zip",
        ".cbr" => "application/vnd.comicbook-rar",
        ".epub" => "application/epub+zip",
        _ => return None,
    })
}

const IMAGE_EXTS: [&str; 11] = [".jpg", ".jpeg", ".jfif", ".pjpeg", ".pjp", ".png", ".gif", ".webp", ".bmp", ".tiff", ".tif"];
const VIDEO_EXTS: [&str; 8] = [".mp4", ".avi", ".mov", ".mkv", ".webm", ".mpg", ".mpeg", ".wmv"];

pub fn image_mime_type(name: &str) -> &'static str {
    let ext = jsutil::ext_lower(name);
    if IMAGE_EXTS.contains(&ext.as_str()) {
        mime_type(&ext).unwrap()
    } else {
        "image/jpeg"
    }
}

pub fn video_mime_type(name: &str) -> &'static str {
    let ext = jsutil::ext_lower(name);
    if VIDEO_EXTS.contains(&ext.as_str()) {
        mime_type(&ext).unwrap()
    } else {
        "video/mp4"
    }
}

/// Mime type of a file inside an archive, or None when unknown (no catch-all default).
pub fn archive_mime_type(name: &str) -> Option<&'static str> {
    mime_type(&jsutil::ext_lower(name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn wsl_paths_become_drive_letters() {
        assert_eq!(to_native_path("/mnt/z"), "Z:\\");
        assert_eq!(to_native_path("/mnt/z/media/x"), "Z:\\media/x");
        assert_eq!(to_native_path("C:\\x"), "C:\\x");
        assert_eq!(to_native_path("z:"), "Z:\\");
    }

    #[test]
    fn archive_mime_has_no_default() {
        assert_eq!(archive_mime_type("a.PDF"), Some("application/pdf"));
        assert_eq!(archive_mime_type("a.bin"), None);
        assert_eq!(image_mime_type("a.bin"), "image/jpeg");
    }
}
