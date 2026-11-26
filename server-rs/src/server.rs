//! Server start-up, routes, static files and shutdown, shared by both programs.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{Request, State};
use axum::middleware::{from_fn, from_fn_with_state, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, MethodRouter};
use axum::Router;
use tower::ServiceExt;

use crate::app::{self, App, AppRef};
use crate::{error, info, warn};
use crate::security::{self, rate_limit, RateLimiter};
use crate::{ai, annotations, archives, browse, cache, comics, config, documents, jsutil, media, mega, panels, routes, session, thumbs};

pub const HELP: &str = "File Browser

Usage: filebrowser [FOLDER]

Serves FOLDER (default: the current directory) on http://localhost:PORT.

Environment (also read from .env next to the program, ../.env and
%LOCALAPPDATA%\\FileBrowser\\.env):
  PORT                 port to listen on (default 3000)
  AUTH                 TRUE to require Google sign-in (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BASE_URL)
  SESSION_SECRET       key for session cookies (required when NODE_ENV=production)
  AI_PROVIDER          lmstudio | openrouter | opencodego (LMSTUDIO_URL, OPENROUTER_API_KEY, OPENCODEGO_API_KEY)
  LOG_LEVEL            debug | info | warn | error
  FILEBROWSER_APP_DIR  folder holding public/ (found automatically)

External tools used when present on PATH: ffmpeg/ffprobe (video), pdftoppm/pdfinfo/pdftotext
(PDF), gs (PDF fallback and checks), unrar (RAR fallback), node (mega.nz only).
";

/// Environment, warnings and the served folder: everything that comes before listening.
/// Exits the process when the configuration cannot work (production without a session secret).
pub fn prepare(folder: &str) -> AppRef {
    let app_dir = config::find_app_dir();
    config::load_env(&app_dir);
    let auth = config::auth_enabled();
    for w in config::validate_env(auth) {
        warn!("Environment: {}", w);
    }
    let production = std::env::var("NODE_ENV").as_deref() == Ok("production");
    if std::env::var("SESSION_SECRET").map(|s| s.is_empty()).unwrap_or(true) {
        if production {
            error!("SESSION_SECRET environment variable is required. Generate one with: openssl rand -hex 32");
            std::process::exit(1);
        }
        warn!("SESSION_SECRET not set. Using insecure default for development. Set SESSION_SECRET in .env for production.");
    }
    let base_dir = config::resolve_base_dir(folder);
    if !std::path::Path::new(&base_dir).exists() {
        warn!("Base directory does not exist: {}", base_dir);
    }
    info!("File Browser Server Starting...");
    info!("Base directory: {}", base_dir);
    info!("Authentication: {}", if auth { "ENABLED" } else { "DISABLED" });
    if !app_dir.join("public").join("index.html").is_file() {
        warn!("Web app not found in {} (set FILEBROWSER_APP_DIR)", app_dir.join("public").display());
    }
    Arc::new(App::new(base_dir, app_dir, auth))
}

/// Serve until `shutdown` completes.
pub async fn serve(listener: tokio::net::TcpListener, state: AppRef, shutdown: impl std::future::Future<Output = ()> + Send + 'static) {
    let router = build_router(state);
    let server = axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>()).with_graceful_shutdown(shutdown);
    if let Err(e) = server.await {
        error!("Server error: {}", e);
    }
    info!("Server closed successfully");
}

/// The `filebrowser` program: serve FOLDER (default: the current one) until Ctrl+C.
pub async fn run_cli(args: Vec<String>) {
    let state = prepare(args.first().map(String::as_str).unwrap_or("."));
    let port = config::port();
    let listener = match bind(port) {
        Ok(l) => l,
        Err(e) => {
            error!("Cannot listen on port {}: {}", port, e);
            std::process::exit(1);
        }
    };
    info!("Server running at http://localhost:{}", port);
    info!("Serving files from: {}", state.base_dir());
    info!("Server started successfully!");
    serve(listener, state, shutdown_signal()).await;
}

/// Dual-stack listener, like Node's default: IPv4 clients show up as ::ffff:a.b.c.d.
pub fn bind(port: u16) -> std::io::Result<tokio::net::TcpListener> {
    use socket2::{Domain, Protocol, Socket, Type};
    let v6 = (|| -> std::io::Result<Socket> {
        let s = Socket::new(Domain::IPV6, Type::STREAM, Some(Protocol::TCP))?;
        s.set_only_v6(false)?;
        #[cfg(not(windows))]
        s.set_reuse_address(true)?;
        s.bind(&SocketAddr::from(([0u16; 8], port)).into())?;
        Ok(s)
    })();
    let socket = match v6 {
        Ok(s) => s,
        // The port is taken: say so. (An IPv4-only bind beside another server's dual-stack
        // socket would succeed on Windows, and localhost would still reach the other server.)
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => return Err(e),
        // No IPv6 on this machine: IPv4 only
        Err(_) => {
            let s = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))?;
            #[cfg(not(windows))]
            s.set_reuse_address(true)?;
            s.bind(&SocketAddr::from(([0, 0, 0, 0], port)).into())?;
            s
        }
    };
    socket.listen(1024)?;
    socket.set_nonblocking(true)?;
    tokio::net::TcpListener::from_std(socket.into())
}

/// First Ctrl+C / SIGTERM: stop accepting and give open streams 3 seconds; a second one exits now.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
    info!("Shutdown signal received. Shutting down...");
    tokio::spawn(async {
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_secs(3)) => {}
            _ = tokio::signal::ctrl_c() => { info!("Forced exit"); std::process::exit(1); }
        }
        std::process::exit(0);
    });
}

fn limited(r: MethodRouter<AppRef>, l: &Arc<RateLimiter>) -> MethodRouter<AppRef> {
    r.route_layer(from_fn_with_state(l.clone(), rate_limit))
}

pub fn build_router(state: AppRef) -> Router {
    let heavy = RateLimiter::new(15 * 60, 100);
    let doc_preview = RateLimiter::new(60, 30);
    let media_preview = RateLimiter::new(60, 30);
    let mega_limit = RateLimiter::new(60, 120);

    // Reachable without signing in (the UI needs them to show the sign-in state)
    let public = Router::new()
        .route("/auth/google", get(routes::google_start))
        .route("/auth/google/callback", get(routes::google_callback))
        .route("/auth/logout", post(routes::logout))
        .route("/login-failed", get(routes::login_failed))
        .route("/auth/user", get(routes::auth_user))
        .route("/api/readme", get(routes::readme))
        .route("/api/server-info", get(routes::server_info))
        .route("/api/config/dirs", get(routes::config_dirs))
        .route("/api/config/root", post(routes::config_root))
        .route(
            "/api/config/credentials/{service}",
            get(routes::get_credentials).put(routes::put_credentials).delete(routes::delete_credentials),
        );

    let protected = Router::new()
        // Browsing and files
        .route("/api/browse", get(browse::browse))
        .route("/api/library", get(browse::library))
        .route("/files/list", get(browse::file_list))
        .route("/files", get(browse::serve_file))
        .route("/api/current-path", get(browse::get_current_path).post(browse::post_current_path))
        .route("/api/directories", get(browse::directories))
        .route("/api/search", get(browse::search))
        .route("/api/open-file", post(browse::open_file))
        .route("/docx-preview", get(documents::docx_preview))
        .route("/api/file", delete(browse::delete_file))
        .route("/api/file/rename", post(browse::rename_file))
        .route("/api/file/move", post(browse::move_file))
        // Documents
        .route("/api/pdf-info", get(media::pdf::info))
        .route("/api/validate-pdf", get(media::pdf::validate))
        .route("/pdf-preview", limited(get(media::pdf::preview), &doc_preview))
        .route("/epub-cover", get(documents::epub_cover))
        .route("/epub-preview", get(documents::epub_preview))
        .route("/cover.jpeg", get(documents::cover_fallback))
        .route("/cover.jpg", get(documents::cover_fallback))
        .route("/images/{filename}", get(documents::images_placeholder))
        .route("/archive-contents", get(archives::contents))
        .route("/archive-file", get(archives::file))
        // Comics
        .route("/api/comic-info", get(comics::info))
        .route("/comic-preview", get(comics::preview))
        .route("/api/comic-panels", post(panels::detect))
        .route("/archive-video", get(comics::archive_video))
        // Video
        .route("/video-transcode", limited(get(media::video::transcode), &media_preview))
        .route("/video-stream", get(media::video::stream))
        .route("/api/video-stream-info", limited(get(media::video::stream_info), &media_preview))
        .route("/subtitle", get(media::video::subtitle))
        .route("/video-thumbnail", limited(get(media::video::thumbnail), &media_preview))
        .route("/api/video-codec-check", get(media::video::codec_check))
        // Annotations and bookmarks
        .route(
            "/api/annotations",
            get(annotations::get_annotations).post(annotations::post_annotations).delete(annotations::delete_annotations),
        )
        .route("/api/search-annotations", get(annotations::search_annotations))
        .route("/api/annotations/migrate-sparse", post(annotations::migrate_api))
        .route(
            "/bookmarks",
            get(annotations::get_bookmarks_api)
                .post(annotations::post_bookmark_api)
                .put(annotations::rename_bookmark_api)
                .delete(annotations::delete_bookmark_api),
        )
        // AI
        .route("/api/summarize-file", post(ai::summarize_file))
        .route("/api/analyze-files", limited(post(ai::analyze_files), &heavy))
        // Library thumbnails: one file, or a whole folder streamed in one request
        .route("/api/thumbnail", get(thumbs::one))
        .route("/api/thumbnails", post(thumbs::batch))
        // Cache
        .route("/api/cache/stats", get(cache::routes::stats))
        .route("/api/cache/clear", post(cache::routes::clear))
        // mega.nz
        .route("/api/mega/list", limited(get(mega::list), &mega_limit))
        .route("/api/mega/file", limited(get(mega::file), &mega_limit))
        .route("/api/mega/comic-info", limited(get(mega::comic_info), &mega_limit))
        .route("/api/mega/comic-page", limited(get(mega::comic_page), &mega_limit))
        .route_layer(from_fn_with_state(state.clone(), security::require_auth));

    Router::new()
        .route("/favicon.ico", get(|| async { axum::http::StatusCode::NO_CONTENT }))
        .merge(public)
        .merge(protected)
        .fallback(fallback)
        .method_not_allowed_fallback(fallback)
        .layer(from_fn_with_state(state.clone(), serve_static))
        .layer(from_fn_with_state(state.clone(), session::middleware))
        .layer(from_fn(security::helmet))
        .with_state(state)
}

/// Unknown routes: the sign-in gate first (as the global middleware did), then a JSON 404.
async fn fallback(State(app): State<AppRef>, req: Request) -> Response {
    if app.auth_enabled {
        let authed = req.extensions().get::<session::Session>().map(security::is_authenticated).unwrap_or(false);
        if !authed {
            return security::unauthenticated(req.uri().path());
        }
    }
    let url = req.uri().path_and_query().map(|p| p.to_string()).unwrap_or_default();
    app::route_not_found(req.method(), &url)
}

/// The web app in public/, served ahead of the API routes like express.static was.
async fn serve_static(State(app): State<AppRef>, req: Request, next: Next) -> Response {
    let method = req.method().clone();
    if method != axum::http::Method::GET && method != axum::http::Method::HEAD {
        return next.run(req).await;
    }
    let raw = req.uri().path().to_string();
    let Some(decoded) = jsutil::decode_uri_component(&raw) else { return next.run(req).await };
    let rel = decoded.trim_start_matches('/');
    if rel.split(['/', '\\']).any(|seg| seg == "..") || rel.contains('\0') {
        return next.run(req).await;
    }
    let candidate = app.public_dir.join(rel);
    let servable = if rel.is_empty() || candidate.is_dir() {
        candidate.join("index.html").is_file()
    } else {
        candidate.is_file()
    };
    if !servable {
        return next.run(req).await;
    }
    let Ok(resp) = tower_http::services::ServeDir::new(&app.public_dir).oneshot(req).await;
    let mut resp = resp.into_response();
    resp.headers_mut().insert(axum::http::header::CACHE_CONTROL, "public, max-age=0".parse().unwrap());
    resp
}
