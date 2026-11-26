//! mega.nz browsing. There is no mature mega.nz client for Rust, so a small Node.js sidecar
//! (mega-sidecar/index.js, using megajs) does the mega.nz work. It is started on the first mega.nz
//! request, listens on 127.0.0.1 only and accepts only requests carrying a random token. The
//! saved login stays in this server's encrypted store and is handed over per request.

use std::time::Duration;

use axum::body::Body;
use axum::extract::State;
use axum::response::{IntoResponse, Response};
use base64::Engine;
use serde_json::Value;
use tokio::io::AsyncBufReadExt;

use crate::app::{ApiError, AppRef, Ctx};

struct Running {
    port: u16,
    token: String,
    child: tokio::process::Child,
    /// Held open: the sidecar exits when it closes (also when this server exits)
    _stdin: tokio::process::ChildStdin,
}

#[derive(Default)]
pub struct MegaSidecar {
    inner: tokio::sync::Mutex<Option<Running>>,
}

fn node_program() -> String {
    std::env::var("FB_NODE").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "node".into())
}

impl MegaSidecar {
    async fn ensure(&self, app: &crate::app::App) -> Result<(u16, String), Response> {
        let mut guard = self.inner.lock().await;
        if let Some(r) = guard.as_mut() {
            if matches!(r.child.try_wait(), Ok(None)) {
                return Ok((r.port, r.token.clone()));
            }
            *guard = None;
        }
        let script = app.app_dir.join("mega-sidecar").join("index.js");
        if !script.is_file() {
            return Err(unavailable("the mega.nz helper is not installed"));
        }
        let token: String = {
            use rand::Rng;
            rand::thread_rng().sample_iter(&rand::distributions::Alphanumeric).take(40).map(char::from).collect()
        };
        let mut child = crate::util::command(&node_program())
            .arg(&script)
            .env("SIDECAR_TOKEN", &token)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .map_err(|_| unavailable("Node.js was not found"))?;
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let mut lines = tokio::io::BufReader::new(stdout).lines();
        let port = tokio::time::timeout(Duration::from_secs(15), async {
            while let Ok(Some(line)) = lines.next_line().await {
                if let Some(p) = line.strip_prefix("MEGA_SIDECAR_PORT ") {
                    return p.trim().parse::<u16>().ok();
                }
            }
            None
        })
        .await
        .ok()
        .flatten()
        .ok_or_else(|| unavailable("the mega.nz helper did not start"))?;
        // Keep draining its stdout so it never blocks on a full pipe
        tokio::spawn(async move { while let Ok(Some(_)) = lines.next_line().await {} });
        crate::info!("mega.nz helper listening on 127.0.0.1:{}", port);
        *guard = Some(Running { port, token: token.clone(), child, _stdin: stdin });
        Ok((port, token))
    }

    /// Drop the mega.nz session (the saved login changed).
    pub async fn reset(&self) {
        let running = self.inner.lock().await.as_ref().map(|r| (r.port, r.token.clone()));
        if let Some((port, token)) = running {
            let _ = reqwest::Client::new()
                .post(format!("http://127.0.0.1:{}/reset", port))
                .header("x-sidecar-token", token)
                .timeout(Duration::from_secs(5))
                .send()
                .await;
        }
    }
}

fn unavailable(why: &str) -> Response {
    ApiError::new(503, format!("mega.nz is not available: {}. Install Node.js (or run the installer's tool setup) to browse mega.nz.", why)).into_response()
}

/// Send a request to the sidecar with the saved login; Err holds the response to give back.
async fn call(app: &AppRef, path: &str, ctx: &Ctx) -> Result<reqwest::Response, Response> {
    let Some((user, secret)) = crate::credentials::get(&app.app_dir, "mega") else {
        return Err(ApiError::conflict("No mega.nz login saved. Add it in Settings.").into_response());
    };
    let (port, token) = app.mega.ensure(app).await?;
    let b64 = |s: &str| base64::engine::general_purpose::STANDARD.encode(s);
    let mut req = app
        .http
        .get(format!("http://127.0.0.1:{}{}", port, path))
        .header("x-sidecar-token", token)
        .header("x-mega-user", b64(&user))
        .header("x-mega-secret", b64(&secret));
    if let Some(r) = ctx.header("range") {
        req = req.header("range", r);
    }
    req.send().await.map_err(|e| ApiError::new(502, format!("mega.nz helper error: {}", e)).into_response())
}

fn q(ctx: &Ctx, key: &str) -> String {
    crate::jsutil::encode_uri_component(ctx.q(key).unwrap_or(""))
}

/// Pass the sidecar's answer through: status, the headers that matter, streamed body.
fn relay(r: reqwest::Response) -> Response {
    let mut b = Response::builder().status(r.status().as_u16());
    for name in [
        "content-type", "content-length", "content-range", "accept-ranges", "content-disposition", "x-content-type-options",
        "content-security-policy", "cache-control",
    ] {
        if let Some(v) = r.headers().get(name) {
            b = b.header(name, v.as_bytes());
        }
    }
    b.body(Body::from_stream(r.bytes_stream())).unwrap()
}

// GET /api/mega/list?id=
pub async fn list(State(app): State<AppRef>, ctx: Ctx) -> Response {
    match call(&app, &format!("/list?id={}", q(&ctx, "id")), &ctx).await {
        Ok(r) => relay(r),
        Err(resp) => resp,
    }
}

// GET /api/mega/file?id=[&download=1] (byte ranges supported)
pub async fn file(State(app): State<AppRef>, ctx: Ctx) -> Response {
    if ctx.q_nonempty("id").is_none() {
        return ApiError::bad_request("id is required").into_response();
    }
    match call(&app, &format!("/file?id={}&download={}", q(&ctx, "id"), q(&ctx, "download")), &ctx).await {
        Ok(r) => relay(r),
        Err(resp) => resp,
    }
}

/// Local copy of a mega.nz comic archive: downloaded once by the sidecar, then read like a local file.
async fn comic_copy(app: &AppRef, ctx: &Ctx) -> Result<String, Response> {
    if ctx.q_nonempty("id").is_none() {
        return Err(ApiError::bad_request("id is required").into_response());
    }
    let r = call(app, &format!("/local-copy?id={}", q(ctx, "id")), ctx).await?;
    if !r.status().is_success() {
        return Err(relay(r));
    }
    let v: Value = r.json().await.map_err(|e| ApiError::internal(e).into_response())?;
    v["path"].as_str().map(String::from).ok_or_else(|| ApiError::internal("no path from mega.nz helper").into_response())
}

pub async fn comic_info(State(app): State<AppRef>, ctx: Ctx) -> Response {
    match comic_copy(&app, &ctx).await {
        Ok(path) => crate::comics::info_for(&app, &path).await,
        Err(r) => r,
    }
}

pub async fn comic_page(State(app): State<AppRef>, ctx: Ctx) -> Response {
    match comic_copy(&app, &ctx).await {
        Ok(path) => crate::comics::preview_for(&app, &path, crate::comics::page_param(&ctx)).await,
        Err(r) => r,
    }
}
