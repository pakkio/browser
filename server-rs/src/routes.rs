//! Server info, README, root switching, saved logins (routes/config.routes.js) and Google
//! sign-in (auth.js, lib/auth-routes.js).

use std::path::Path;

use axum::extract::{Path as UrlPath, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use serde_json::{json, Value};

use crate::app::{json, json_status, ApiError, ApiResult, AppRef, Ctx};
use crate::browse::{read_latest_path, save_latest_path};
use crate::jsutil;
use crate::security::{is_authenticated, is_loopback, is_private_address};

// ---------------------------------------------------------------------------------------------
// README for the Help menu

pub async fn readme(State(app): State<AppRef>) -> Response {
    match tokio::fs::read_to_string(app.app_dir.join("README.md")).await {
        Ok(t) => ([(header::CONTENT_TYPE, "text/plain; charset=utf-8")], t).into_response(),
        Err(_) => (axum::http::StatusCode::NOT_FOUND, [(header::CONTENT_TYPE, "text/plain; charset=utf-8")], "README not available").into_response(),
    }
}

// ---------------------------------------------------------------------------------------------
// Server info (public: the UI asks for the root before sign-in)

/// Only the machine itself may change the served root (socket address, not a header).
fn is_local(ctx: &Ctx) -> bool {
    is_loopback(&ctx.remote_addr())
}

fn saved_path_exists(app: &crate::app::App, rel: &str) -> bool {
    if rel.is_empty() {
        return false;
    }
    let base = app.base_dir();
    let full = jsutil::resolve(&base, rel);
    full.starts_with(&jsutil::resolve(&base, "")) && Path::new(&full).is_dir()
}

pub async fn server_info(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let saved = ctx
        .session
        .get_str("currentPath")
        .filter(|s| !s.is_empty())
        .or_else(|| ctx.session.get_str("lastBrowsedPath").filter(|s| !s.is_empty()))
        .unwrap_or_else(|| read_latest_path(&app));
    let current = if saved_path_exists(&app, &saved) { saved } else { String::new() };
    let base = app.base_dir();
    let parent = jsutil::dirname(&base);
    let parent_root = if is_local(&ctx) && parent != base { Value::String(parent) } else { Value::Null };
    json(&json!({ "rootDir": base, "currentPath": current, "parentRoot": parent_root }))
}

// ---------------------------------------------------------------------------------------------
// Root picker and switching (signed-in, local machine only)

fn gate_local(app: &crate::app::App, ctx: &Ctx) -> Result<(), Response> {
    if let Some(r) = auth_gate(app, ctx) {
        return Err(r);
    }
    if !is_local(ctx) {
        return Err(ApiError::forbidden("Changing the root is only allowed from this machine").into_response());
    }
    Ok(())
}

/// requireAuth for routes mounted before the global gate.
fn auth_gate(app: &crate::app::App, ctx: &Ctx) -> Option<Response> {
    if !app.auth_enabled || is_authenticated(&ctx.session) {
        return None;
    }
    Some(json_status(401, &json!({ "error": "Authentication required", "loginUrl": "/auth/google" })))
}

pub async fn config_dirs(State(app): State<AppRef>, ctx: Ctx) -> Response {
    if let Err(r) = gate_local(&app, &ctx) {
        return r;
    }
    let requested = ctx.q("path").unwrap_or("").to_string();
    if requested.is_empty() && cfg!(windows) {
        let drives: Vec<String> = (b'A'..=b'Z').map(|c| format!("{}:\\", c as char)).filter(|d| Path::new(d).exists()).collect();
        return json(&json!({ "path": "", "parent": null, "dirs": drives }));
    }
    let cwd = std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let target = if requested.is_empty() { app.base_dir() } else { requested };
    let dir = jsutil::resolve(&cwd, &crate::config::to_native_path(&target));
    let entries = match crate::browse::read_dir_js(&dir) {
        Ok(e) => e,
        Err(e) => return ApiError::bad_request(e.to_string()).into_response(),
    };
    let mut dirs: Vec<String> = entries.into_iter().filter(|(n, ft)| ft.is_dir() && !n.starts_with('.')).map(|(n, _)| n).collect();
    dirs.sort_by(|a, b| jsutil::locale_cmp(a, b));
    let parent = jsutil::dirname(&dir);
    let parent = if parent == dir {
        if cfg!(windows) { json!("") } else { Value::Null }
    } else {
        json!(parent)
    };
    json(&json!({ "path": dir, "parent": parent, "dirs": dirs }))
}

pub async fn config_root(State(app): State<AppRef>, ctx: Ctx) -> Response {
    if let Err(r) = gate_local(&app, &ctx) {
        return r;
    }
    let Some(requested) = ctx.b_str("path").filter(|s| !s.is_empty()) else {
        return ApiError::bad_request("path is required").into_response();
    };
    match crate::config::set_base_dir(&app, requested) {
        Ok(root) => {
            ctx.session.set("currentPath", json!(""));
            ctx.session.set("lastBrowsedPath", json!(""));
            save_latest_path(&app, "");
            json(&json!({ "success": true, "rootDir": root }))
        }
        Err(e) => ApiError::bad_request(e).into_response(),
    }
}

// ---------------------------------------------------------------------------------------------
// Saved logins: this machine or the private network, never through a forwarding proxy

const SERVICES: [&str; 1] = ["mega"];

fn gate_credentials(app: &crate::app::App, ctx: &Ctx, service: &str) -> Result<(), Response> {
    if let Some(r) = auth_gate(app, ctx) {
        return Err(r);
    }
    let addr = ctx.remote_addr();
    if !is_loopback(&addr) {
        let remote_off = std::env::var("CREDENTIALS_REMOTE").map(|v| v.eq_ignore_ascii_case("off")).unwrap_or(false);
        let proxied = ["x-forwarded-for", "forwarded", "x-real-ip"].iter().any(|h| ctx.headers.contains_key(*h));
        if remote_off || proxied || !is_private_address(&addr) {
            return Err(ApiError::forbidden("Saved logins can only be changed from this machine or your private network").into_response());
        }
    }
    if !SERVICES.contains(&service) {
        return Err(ApiError::bad_request("Unknown service").into_response());
    }
    Ok(())
}

fn describe(app: &crate::app::App, service: &str) -> ApiResult {
    crate::credentials::describe(&app.app_dir, service).map(|v| json(&v)).map_err(ApiError::internal)
}

pub async fn get_credentials(State(app): State<AppRef>, UrlPath(service): UrlPath<String>, ctx: Ctx) -> Response {
    if let Err(r) = gate_credentials(&app, &ctx, &service) {
        return r;
    }
    describe(&app, &service).into_response()
}

pub async fn put_credentials(State(app): State<AppRef>, UrlPath(service): UrlPath<String>, ctx: Ctx) -> Response {
    if let Err(r) = gate_credentials(&app, &ctx, &service) {
        return r;
    }
    let (Some(user), Some(pass)) = (ctx.b_str("username").filter(|s| !s.is_empty()), ctx.b_str("password").filter(|s| !s.is_empty())) else {
        return ApiError::bad_request("username and password are required").into_response();
    };
    if let Err(e) = crate::credentials::save(&app.app_dir, &service, user.trim(), pass) {
        return ApiError::internal(e).into_response();
    }
    app.mega.reset().await; // the next mega.nz request logs in with the new login
    describe(&app, &service).into_response()
}

pub async fn delete_credentials(State(app): State<AppRef>, UrlPath(service): UrlPath<String>, ctx: Ctx) -> Response {
    if let Err(r) = gate_credentials(&app, &ctx, &service) {
        return r;
    }
    if let Err(e) = crate::credentials::remove(&app.app_dir, &service) {
        return ApiError::internal(e).into_response();
    }
    app.mega.reset().await;
    describe(&app, &service).into_response()
}

// ---------------------------------------------------------------------------------------------
// Google sign-in (OAuth 2.0 authorization code flow)

fn base_url() -> String {
    std::env::var("BASE_URL").unwrap_or_else(|_| "http://localhost:3000".into())
}

fn redirect(to: &str) -> Response {
    Response::builder()
        .status(302)
        .header(header::LOCATION, to)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(format!("Found. Redirecting to {}", to).into())
        .unwrap()
}

fn disabled() -> Response {
    json_status(404, &json!({ "error": "Authentication is disabled" }))
}

pub async fn google_start(State(app): State<AppRef>, ctx: Ctx) -> Response {
    if !app.auth_enabled {
        return disabled();
    }
    let state: String = {
        use rand::Rng;
        rand::thread_rng().sample_iter(&rand::distributions::Alphanumeric).take(32).map(char::from).collect()
    };
    ctx.session.set("oauthState", json!(state));
    let client_id = std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default();
    let url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}",
        jsutil::encode_uri_component(&client_id),
        jsutil::encode_uri_component(&format!("{}/auth/google/callback", base_url())),
        jsutil::encode_uri_component("profile email"),
        state
    );
    redirect(&url)
}

async fn exchange(app: &crate::app::App, code: &str) -> Result<Value, String> {
    let params = [
        ("code", code.to_string()),
        ("client_id", std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default()),
        ("client_secret", std::env::var("GOOGLE_CLIENT_SECRET").unwrap_or_default()),
        ("redirect_uri", format!("{}/auth/google/callback", base_url())),
        ("grant_type", "authorization_code".to_string()),
    ];
    let token: Value = app.http.post("https://oauth2.googleapis.com/token").form(&params).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let access = token["access_token"].as_str().ok_or("no access token")?;
    let profile: Value = app
        .http
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .bearer_auth(access)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!({
        "id": profile["sub"], "name": profile["name"], "email": profile["email"], "picture": profile["picture"], "provider": "google"
    }))
}

pub async fn google_callback(State(app): State<AppRef>, ctx: Ctx) -> Response {
    if !app.auth_enabled {
        return disabled();
    }
    let expected = ctx.session.get_str("oauthState");
    ctx.session.remove("oauthState");
    let (Some(code), Some(state)) = (ctx.q_nonempty("code"), ctx.q("state")) else {
        return redirect("/login-failed");
    };
    if expected.as_deref() != Some(state) {
        return redirect("/login-failed");
    }
    match exchange(&app, code).await {
        Ok(user) => {
            crate::info!("User authenticated: {} ({})", user["name"].as_str().unwrap_or(""), user["email"].as_str().unwrap_or(""));
            ctx.session.regenerate();
            ctx.session.set("user", user);
            redirect("/")
        }
        Err(e) => {
            crate::warn!("Google sign-in failed: {}", e);
            redirect("/login-failed")
        }
    }
}

pub async fn logout(State(app): State<AppRef>, ctx: Ctx) -> Response {
    if !app.auth_enabled {
        return disabled();
    }
    let name = ctx.session.get("user").and_then(|u| u["name"].as_str().map(String::from)).unwrap_or_else(|| "Unknown user".into());
    ctx.session.destroy();
    crate::info!("User logged out: {}", name);
    json(&json!({ "success": true, "message": "Logged out successfully" }))
}

pub async fn login_failed(State(app): State<AppRef>) -> Response {
    if !app.auth_enabled {
        return disabled();
    }
    crate::app::text(
        401,
        r#"
                <html>
                    <head><title>Login Failed</title></head>
                    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                        <h1>Authentication Failed</h1>
                        <p>Unable to authenticate with Google. Please try again.</p>
                        <a href="/auth/google" style="background: #4285f4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                            Try Again
                        </a>
                    </body>
                </html>
            "#,
    )
}

pub async fn auth_user(State(app): State<AppRef>, ctx: Ctx) -> Response {
    if !app.auth_enabled {
        return json(&json!({ "authenticated": false, "authDisabled": true }));
    }
    match ctx.session.get("user").filter(Value::is_object) {
        Some(u) => json(&json!({ "authenticated": true, "user": { "name": u["name"], "email": u["email"], "picture": u["picture"] } })),
        None => json(&json!({ "authenticated": false })),
    }
}
