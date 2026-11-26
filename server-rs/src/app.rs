//! Shared state, the request context every handler receives, and response helpers that keep
//! the status codes, content types and JSON shapes of the original Express server.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use axum::body::{Body, Bytes};
use axum::extract::{ConnectInfo, FromRequest, Request};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{json, Map, Value};

use crate::cache::FileCache;
use crate::session::Session;

// ---------------------------------------------------------------------------------------------
// Logger: "[ISO] [LEVEL] message meta", like lib/logger.js

#[derive(Clone, Copy, PartialEq, PartialOrd)]
pub enum Level {
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
}

pub fn log_level() -> Level {
    static LEVEL: std::sync::OnceLock<Level> = std::sync::OnceLock::new();
    *LEVEL.get_or_init(|| match std::env::var("LOG_LEVEL").as_deref() {
        Ok("debug") => Level::Debug,
        Ok("warn") => Level::Warn,
        Ok("error") => Level::Error,
        _ => Level::Info,
    })
}

static LOG_FILE: std::sync::OnceLock<std::sync::Mutex<std::fs::File>> = std::sync::OnceLock::new();

/// Send the log to a file instead of the console (the desktop window has no console).
/// The file is started afresh when it has grown past 5 MB.
pub fn log_to_file(path: &std::path::Path) {
    if std::fs::metadata(path).map(|m| m.len() > 5 * 1024 * 1024).unwrap_or(false) {
        let _ = std::fs::remove_file(path);
    }
    if let Ok(f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = LOG_FILE.set(std::sync::Mutex::new(f));
    }
}

pub fn log(level: Level, msg: &str) {
    if level < log_level() {
        return;
    }
    let name = match level {
        Level::Debug => "DEBUG",
        Level::Info => "INFO",
        Level::Warn => "WARN",
        Level::Error => "ERROR",
    };
    let line = format!("[{}] [{}] {}", crate::jsutil::now_iso(), name, msg);
    if let Some(file) = LOG_FILE.get() {
        use std::io::Write;
        if let Ok(mut f) = file.lock() {
            let _ = writeln!(f, "{}", line);
        }
        return;
    }
    if level >= Level::Warn {
        eprintln!("{}", line);
    } else {
        println!("{}", line);
    }
}

#[macro_export]
macro_rules! info { ($($t:tt)*) => { $crate::app::log($crate::app::Level::Info, &format!($($t)*)) } }
#[macro_export]
macro_rules! warn { ($($t:tt)*) => { $crate::app::log($crate::app::Level::Warn, &format!($($t)*)) } }
#[macro_export]
macro_rules! error { ($($t:tt)*) => { $crate::app::log($crate::app::Level::Error, &format!($($t)*)) } }
#[macro_export]
macro_rules! debug { ($($t:tt)*) => { $crate::app::log($crate::app::Level::Debug, &format!($($t)*)) } }

// ---------------------------------------------------------------------------------------------
// State

pub struct App {
    base_dir: RwLock<String>,
    /// Folder holding public/, README.md, .latest and (by default) the saved logins
    pub app_dir: PathBuf,
    pub public_dir: PathBuf,
    pub auth_enabled: bool,
    pub production: bool,
    pub cache: FileCache,
    pub http: reqwest::Client,
    pub sessions: crate::session::SessionStore,
    pub pdf: crate::media::pdf::PdfState,
    pub video: crate::media::video::VideoState,
    pub comics: crate::comics::ComicState,
    pub archives: crate::archives::ArchiveState,
    pub panels: crate::panels::PanelState,
    pub mega: crate::mega::MegaSidecar,
}

pub type AppRef = Arc<App>;

impl App {
    pub fn new(base_dir: String, app_dir: PathBuf, auth_enabled: bool) -> Self {
        let production = std::env::var("NODE_ENV").as_deref() == Ok("production");
        App {
            base_dir: RwLock::new(base_dir),
            public_dir: app_dir.join("public"),
            app_dir,
            auth_enabled,
            production,
            cache: FileCache::new(24 * 60 * 60 * 1000, 500 * 1024 * 1024),
            http: reqwest::Client::builder()
                .user_agent("filebrowser")
                .build()
                .expect("HTTP client"),
            sessions: crate::session::SessionStore::default(),
            pdf: Default::default(),
            video: Default::default(),
            comics: Default::default(),
            archives: Default::default(),
            panels: Default::default(),
            mega: Default::default(),
        }
    }

    /// The served root; it can be switched at runtime from the settings panel.
    pub fn base_dir(&self) -> String {
        self.base_dir.read().unwrap().clone()
    }

    pub fn set_base_dir_raw(&self, dir: String) {
        *self.base_dir.write().unwrap() = dir;
    }

    /// Real path of the served root (falls back to the configured path if it does not exist).
    pub fn base_real(&self) -> String {
        let b = self.base_dir();
        crate::jsutil::realpath(&b).unwrap_or(b)
    }
}

// ---------------------------------------------------------------------------------------------
// Errors: ApiError + the global error handler shape {error, timestamp[, details]}

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
    pub details: Option<Value>,
}

impl ApiError {
    pub fn new(status: u16, msg: impl Into<String>) -> Self {
        ApiError {
            status: StatusCode::from_u16(status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            message: msg.into(),
            details: None,
        }
    }
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::new(400, msg)
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::new(403, msg)
    }
    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::new(404, msg)
    }
    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::new(409, msg)
    }
    /// A non-ApiError failure: the client only sees "Internal server error".
    pub fn internal(err: impl std::fmt::Display) -> Self {
        crate::error!("Express error handler: {}", err);
        Self::new(500, "Internal server error")
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut body = json!({ "error": self.message, "timestamp": crate::jsutil::now_iso() });
        if let Some(d) = self.details {
            body["details"] = d;
        }
        json_status(self.status.as_u16(), &body)
    }
}

impl From<std::io::Error> for ApiError {
    fn from(e: std::io::Error) -> Self {
        ApiError::internal(e)
    }
}

pub type ApiResult = Result<Response, ApiError>;

// ---------------------------------------------------------------------------------------------
// Responses with Express' content types

pub fn json_status(status: u16, v: &Value) -> Response {
    let body = serde_json::to_vec(v).unwrap_or_default();
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json; charset=utf-8")
        .body(Body::from(body))
        .unwrap()
}

pub fn json(v: &Value) -> Response {
    json_status(200, v)
}

/// `res.status(n).send(string)`: Express labels strings as HTML.
pub fn text(status: u16, s: impl Into<String>) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(s.into()))
        .unwrap()
}

/// A binary body with an explicit content type.
pub fn bytes(status: u16, content_type: &str, data: impl Into<Bytes>) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(data.into()))
        .unwrap()
}

pub fn set_header(resp: &mut Response, name: &'static str, value: &str) {
    if let Ok(v) = HeaderValue::from_str(value) {
        resp.headers_mut().insert(name, v);
    }
}

pub fn with_header(mut resp: Response, name: &'static str, value: &str) -> Response {
    set_header(&mut resp, name, value);
    resp
}

/// `Content-Disposition: inline; filename="name"`, with characters a header cannot hold encoded.
pub fn inline_disposition(name: &str) -> String {
    if name.is_ascii() && !name.contains('"') {
        format!("inline; filename=\"{}\"", name)
    } else {
        format!("inline; filename*=UTF-8''{}", crate::jsutil::encode_uri_component(name))
    }
}

// ---------------------------------------------------------------------------------------------
// Request context

pub struct Ctx {
    pub query: HashMap<String, String>,
    pub headers: HeaderMap,
    pub remote: Option<SocketAddr>,
    pub session: Session,
    /// Parsed JSON or urlencoded body; an empty object when there is none
    pub body: Map<String, Value>,
    /// The raw body (used for the comic page JPEG)
    pub raw: Bytes,
}

impl Ctx {
    pub fn q(&self, key: &str) -> Option<&str> {
        self.query.get(key).map(|s| s.as_str())
    }
    /// A query value that is present and non-empty (JavaScript truthiness of a string).
    pub fn q_nonempty(&self, key: &str) -> Option<&str> {
        self.q(key).filter(|s| !s.is_empty())
    }
    pub fn b(&self, key: &str) -> Option<&Value> {
        self.body.get(key)
    }
    pub fn b_str(&self, key: &str) -> Option<&str> {
        self.body.get(key).and_then(|v| v.as_str())
    }
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }
    pub fn remote_addr(&self) -> String {
        match self.remote {
            Some(SocketAddr::V4(a)) => a.ip().to_string(),
            Some(SocketAddr::V6(a)) => {
                // Node reports IPv4 clients of a dual-stack socket as ::ffff:a.b.c.d
                a.ip().to_string()
            }
            None => String::new(),
        }
    }
}

const BODY_LIMIT: usize = 10 * 1024 * 1024;

pub fn parse_query(q: Option<&str>) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(q) = q {
        for (k, v) in form_urlencoded::parse(q.as_bytes()) {
            map.entry(k.into_owned()).or_insert_with(|| v.into_owned());
        }
    }
    map
}

impl<S: Send + Sync> FromRequest<S> for Ctx {
    type Rejection = Response;

    async fn from_request(req: Request, _state: &S) -> Result<Self, Self::Rejection> {
        let (parts, body) = req.into_parts();
        let query = parse_query(parts.uri.query());
        let remote = parts.extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0);
        let session = parts.extensions.get::<Session>().cloned().unwrap_or_default();
        let raw = axum::body::to_bytes(body, BODY_LIMIT)
            .await
            .map_err(|_| ApiError::new(413, "request entity too large").into_response())?;
        let ctype = parts
            .headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        let mut body = Map::new();
        if !raw.is_empty() {
            if ctype.starts_with("application/json") || ctype.contains("+json") {
                match serde_json::from_slice::<Value>(&raw) {
                    Ok(Value::Object(m)) => body = m,
                    Ok(_) => {
                        return Err(ApiError::bad_request("Unexpected JSON body").into_response());
                    }
                    Err(e) => return Err(ApiError::bad_request(e.to_string()).into_response()),
                }
            } else if ctype.starts_with("application/x-www-form-urlencoded") {
                for (k, v) in form_urlencoded::parse(&raw) {
                    body.entry(k.into_owned()).or_insert(Value::String(v.into_owned()));
                }
            }
        }
        Ok(Ctx {
            query,
            headers: parts.headers,
            remote,
            session,
            body,
            raw,
        })
    }
}

/// The 404 for an unknown route: {error, path, method}.
pub fn route_not_found(method: &Method, url: &str) -> Response {
    crate::warn!("Route not found: {} {}", method, url);
    json_status(404, &json!({ "error": "Route not found", "path": url, "method": method.as_str() }))
}
