//! `filebrowser-app`: File Browser in its own desktop window. The server runs inside the program
//! (on the first free port from PORT, default 3000) and the window shows it through WebView2,
//! which Windows 10 and 11 include. Closing the window stops everything.
//!
//!   filebrowser-app [FOLDER]        serve FOLDER (asks for one when none is given)
//!   filebrowser-app --help-page DIR open on the keyboard-shortcut help
//!
//! No console: the log goes to %LOCALAPPDATA%\FileBrowser\app.log.

#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(not(windows))]
fn main() {
    eprintln!("The File Browser window is available on Windows; run `filebrowser FOLDER` and open http://localhost:3000.");
    std::process::exit(1);
}

#[cfg(windows)]
fn main() {
    desktop::run();
}

#[cfg(windows)]
mod desktop {
    use std::path::{Path, PathBuf};

    use fbcore::{config, server, tools};
    use std::time::{Duration, Instant};

    use base64::Engine;
    use tao::dpi::{LogicalSize, PhysicalPosition};
    use tao::event::{Event, WindowEvent};
    use std::collections::HashMap;

    use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy, EventLoopWindowTarget};
    use tao::window::{Fullscreen, Icon, Window, WindowBuilder, WindowId};
    use wry::{NewWindowResponse, PageLoadEvent, WebContext, WebView, WebViewBuilder};

    const ICON: &[u8] = include_bytes!("../../../installer/filebrowser.ico");

    /// WebView2 keeps a full-screen page inside the window. The page reports each change and the
    /// window follows, so F / Ctrl+F (and a video's full-screen button) fill the whole screen.
    const FULLSCREEN_BRIDGE: &str = r#"
        document.addEventListener('fullscreenchange', () => {
            window.ipc.postMessage(document.fullscreenElement ? 'fullscreen:on' : 'fullscreen:off');
        });
    "#;

    enum UserEvent {
        Fullscreen(WindowId, bool),
        /// The page asked for a new tab (a file opened from the library view): a new window
        Open(String),
        /// A window's page finished loading
        Loaded(WindowId),
    }

    /// The splash stays at least this long (no flash), at most until the page is ready or this.
    const SPLASH_MIN: Duration = Duration::from_millis(1200);
    const SPLASH_MAX: Duration = Duration::from_secs(15);

    /// The largest image stored as PNG inside the .ico (its 256 px frame). Read straight from the
    /// ICO directory: the `image` crate's ICO decoder rejects this file.
    fn icon_png() -> Option<&'static [u8]> {
        let count = u16::from_le_bytes([*ICON.get(4)?, *ICON.get(5)?]) as usize;
        (0..count)
            .filter_map(|i| {
                let e = ICON.get(6 + 16 * i..22 + 16 * i)?;
                let size = u32::from_le_bytes([e[8], e[9], e[10], e[11]]) as usize;
                let offset = u32::from_le_bytes([e[12], e[13], e[14], e[15]]) as usize;
                let data = ICON.get(offset..offset + size)?;
                let width = if e[0] == 0 { 256 } else { e[0] as u32 };
                data.starts_with(b"\x89PNG").then_some((width, data))
            })
            .max_by_key(|(w, _)| *w)
            .map(|(_, d)| d)
    }

    /// The icon as a PNG data URL, for the splash.
    fn icon_data_url() -> String {
        icon_png().map(|b| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b))).unwrap_or_default()
    }

    fn splash_html(folder: &str) -> String {
        let esc = |t: &str| t.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
        format!(
            r#"<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;height:100%;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif;user-select:none;cursor:default}}
body{{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#e8f4f8;
background:radial-gradient(circle at 30% 20%,#2a4a6b 0%,#16213e 55%,#0f1626 100%)}}
img{{width:112px;height:112px;filter:drop-shadow(0 8px 24px rgba(78,205,196,.45));animation:pop .5s ease-out}}
h1{{margin:6px 0 0;font-size:26px;font-weight:600;letter-spacing:.5px}}
.v{{font-size:14px;color:#4ecdc4;font-weight:600}}
.f{{font-size:12px;color:#8aa3b8;max-width:420px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.bar{{width:180px;height:3px;border-radius:2px;background:rgba(78,205,196,.2);overflow:hidden;margin-top:8px}}
.bar::after{{content:"";display:block;width:40%;height:100%;background:#4ecdc4;animation:slide 1.1s ease-in-out infinite}}
@keyframes slide{{from{{transform:translateX(-100%)}}to{{transform:translateX(250%)}}}}
@keyframes pop{{from{{transform:scale(.8);opacity:0}}to{{transform:scale(1);opacity:1}}}}
</style></head><body><img src="{icon}" alt=""><h1>File Browser</h1><div class="v">Version {version}</div>
<div class="f">{folder}</div><div class="bar"></div></body></html>"#,
            icon = icon_data_url(),
            version = env!("CARGO_PKG_VERSION"),
            folder = esc(folder),
        )
    }

    /// A small borderless window in the middle of the screen with the icon and the version.
    fn open_splash(target: &EventLoopWindowTarget<UserEvent>, context: &mut WebContext, folder: &str) -> Option<(Window, WebView)> {
        let (w, h) = (480.0, 300.0);
        let mut builder = WindowBuilder::new()
            .with_title("File Browser")
            .with_inner_size(LogicalSize::new(w, h))
            .with_decorations(false)
            .with_resizable(false)
            .with_always_on_top(true)
            .with_window_icon(window_icon());
        if let Some(m) = target.primary_monitor() {
            let (scale, size, pos) = (m.scale_factor(), m.size(), m.position());
            builder = builder.with_position(PhysicalPosition::new(
                pos.x + ((size.width as f64 - w * scale) / 2.0) as i32,
                pos.y + ((size.height as f64 - h * scale) / 2.0) as i32,
            ));
        }
        let window = builder.build(target).ok()?;
        let view = WebViewBuilder::new_with_web_context(context).with_html(splash_html(folder)).build(&window).ok()?;
        Some((window, view))
    }

    /// A window with its page. The first one is the main window: closing it stops File Browser.
    fn open_window(
        target: &EventLoopWindowTarget<UserEvent>,
        context: &mut WebContext,
        proxy: &EventLoopProxy<UserEvent>,
        url: &str,
        title: &str,
        origin: &str,
        visible: bool,
    ) -> Result<(Window, WebView), String> {
        let window = WindowBuilder::new()
            .with_title(title)
            .with_inner_size(LogicalSize::new(1400.0, 900.0))
            .with_window_icon(window_icon())
            .with_visible(visible)
            .build(target)
            .map_err(|e| e.to_string())?;
        let id = window.id();
        let (ipc_proxy, open_proxy, load_proxy, origin) = (proxy.clone(), proxy.clone(), proxy.clone(), origin.to_string());
        let webview = WebViewBuilder::new_with_web_context(context)
            .with_url(url)
            .with_clipboard(true)
            .with_initialization_script(FULLSCREEN_BRIDGE)
            .with_on_page_load_handler(move |event, _| {
                if let PageLoadEvent::Finished = event {
                    let _ = load_proxy.send_event(UserEvent::Loaded(id));
                }
            })
            .with_ipc_handler(move |req| {
                let on = match req.body().as_str() {
                    "fullscreen:on" => true,
                    "fullscreen:off" => false,
                    _ => return,
                };
                let _ = ipc_proxy.send_event(UserEvent::Fullscreen(id, on));
            })
            // There are no tabs here: File Browser pages open in a window of their own, anything
            // else (a link to a web site) in the default browser
            .with_new_window_req_handler(move |url, _| {
                if url.starts_with(&origin) {
                    let _ = open_proxy.send_event(UserEvent::Open(url));
                } else if url.starts_with("http://") || url.starts_with("https://") {
                    let _ = std::process::Command::new("explorer.exe").arg(&url).spawn();
                }
                NewWindowResponse::Deny
            })
            .build(&window)
            .map_err(|e| e.to_string())?;
        Ok((window, webview))
    }

    /// Window title for a page: the file opened in it, or the folder.
    fn title_for(url: &str, folder: &str) -> String {
        let file = url.split_once("?file=").map(|(_, f)| f.split('&').next().unwrap_or(f));
        match file.and_then(fbcore::jsutil::decode_uri_component) {
            Some(f) => format!("File Browser - {}", f.rsplit('/').next().unwrap_or(&f)),
            None => format!("File Browser - {}", folder),
        }
    }

    fn data_dir() -> PathBuf {
        let d = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("FileBrowser");
        let _ = std::fs::create_dir_all(&d);
        d
    }

    fn error_box(text: &str) {
        rfd::MessageDialog::new()
            .set_title("File Browser")
            .set_description(text)
            .set_level(rfd::MessageLevel::Error)
            .show();
    }

    /// A folder as Explorer or filebrowser.cmd hands it over. `"Z:\"` arrives as `Z:"` (the
    /// backslash escapes the closing quote under Windows' command-line rules), so the root is put
    /// back together; the launcher's `"Z:\."` form loses its dot.
    fn clean_folder(arg: &str) -> String {
        let mut f = arg.trim().trim_end_matches('"').to_string();
        if f.ends_with("\\.") {
            f.pop();
        }
        if f.len() > 3 && f.ends_with('\\') {
            f.pop();
        }
        if f.len() == 2 && f.ends_with(':') {
            f.push('\\');
        }
        f
    }

    fn pick_folder() -> Option<String> {
        let start = if Path::new("Z:\\").is_dir() {
            PathBuf::from("Z:\\")
        } else {
            std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\"))
        };
        rfd::FileDialog::new()
            .set_title("Folder to open in File Browser")
            .set_directory(start)
            .pick_folder()
            .map(|p| p.to_string_lossy().into_owned())
    }

    fn window_icon() -> Option<Icon> {
        let img = image::load_from_memory_with_format(icon_png()?, image::ImageFormat::Png).ok()?.to_rgba8();
        let (w, h) = img.dimensions();
        Icon::from_rgba(img.into_raw(), w, h).ok()
    }

    pub fn run() {
        let args: Vec<String> = std::env::args().skip(1).collect();
        let help_page = args.iter().any(|a| a == "--help-page");
        let folder_arg = args.iter().find(|a| !a.starts_with("--")).map(|a| clean_folder(a));

        let data = data_dir();
        fbcore::app::log_to_file(&data.join("app.log"));
        let app_dir = config::find_app_dir();

        // Downloaded tools on PATH; if some are still missing, fetch them while the window opens
        if tools::setup(&app_dir) {
            if let Some(mut child) = tools::fetch_in_background(&app_dir) {
                let dir = app_dir.clone();
                std::thread::spawn(move || {
                    let _ = child.wait();
                    tools::setup(&dir);
                });
            }
        }

        let Some(folder) = folder_arg.or_else(pick_folder) else { return };
        if !Path::new(&folder).is_dir() {
            error_box(&format!("Not a folder: {}", folder));
            return;
        }

        let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
        let proxy = event_loop.create_proxy();
        let mut context = WebContext::new(Some(data.join("WebView2")));
        let mut splash = open_splash(&event_loop, &mut context, &folder);
        let splash_shown = Instant::now();

        let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
            Ok(r) => r,
            Err(e) => return error_box(&format!("File Browser could not start: {}", e)),
        };
        let state = server::prepare(&folder);
        let first = config::port();
        // Another File Browser may already use the port: take the next free one
        let bound = runtime.block_on(async { (first..first.saturating_add(50)).find_map(|p| server::bind(p).ok().map(|l| (l, p))) });
        let Some((listener, port)) = bound else {
            return error_box(&format!("No free port between {} and {}.", first, first.saturating_add(49)));
        };
        fbcore::info!("Window app serving {} on http://localhost:{}", state.base_dir(), port);
        let (stop_tx, stop_rx) = tokio::sync::oneshot::channel::<()>();
        std::thread::spawn(move || {
            runtime.block_on(server::serve(listener, state, async {
                let _ = stop_rx.await;
            }));
        });

        let origin = format!("http://localhost:{}/", port);
        let url = format!("{}{}", origin, if help_page { "?help=shortcuts" } else { "" });
        // Hidden until its page is ready, while the splash shows
        let main = open_window(&event_loop, &mut context, &proxy, &url, &format!("File Browser - {}", folder), &origin, splash.is_none());
        let (main_window, main_view) = match main {
            Ok(w) => w,
            Err(e) => {
                drop(splash.take()); // the message box must not sit behind the splash
                // No WebView2 runtime: fall back to the default browser while this program runs
                fbcore::error!("WebView2 unavailable: {}", e);
                let _ = std::process::Command::new("explorer.exe").arg(&url).spawn();
                rfd::MessageDialog::new()
                    .set_title("File Browser")
                    .set_description(format!(
                        "The File Browser window needs Microsoft Edge WebView2, which is missing, so File Browser opened in your browser at {}.\n\nPress OK to stop File Browser.",
                        url
                    ))
                    .show();
                return;
            }
        };
        let main_id = main_window.id();
        let mut windows: HashMap<WindowId, (Window, WebView)> = HashMap::new();
        windows.insert(main_id, (main_window, main_view));

        let mut stop = Some(stop_tx);
        let mut main_loaded = false;
        event_loop.run(move |event, target, control_flow| {
            *control_flow = ControlFlow::Wait;
            // Swap the splash for the main window once its page is ready (and the splash was seen)
            if splash.is_some() {
                let shown = splash_shown.elapsed();
                if (main_loaded && shown >= SPLASH_MIN) || shown >= SPLASH_MAX {
                    if let Some((w, _)) = windows.get(&main_id) {
                        w.set_visible(true);
                        w.set_focus();
                    }
                    splash = None;
                } else {
                    let until = if main_loaded { SPLASH_MIN } else { SPLASH_MAX };
                    *control_flow = ControlFlow::WaitUntil(splash_shown + until);
                }
            }
            match event {
                Event::UserEvent(UserEvent::Loaded(id)) if id == main_id && !main_loaded => {
                    main_loaded = true;
                    if splash.is_some() {
                        *control_flow = ControlFlow::WaitUntil((splash_shown + SPLASH_MIN).max(Instant::now()));
                    }
                }
                Event::UserEvent(UserEvent::Fullscreen(id, on)) => {
                    if let Some((w, _)) = windows.get(&id) {
                        w.set_fullscreen(if on { Some(Fullscreen::Borderless(None)) } else { None });
                    }
                }
                Event::UserEvent(UserEvent::Open(url)) => {
                    match open_window(target, &mut context, &proxy, &url, &title_for(&url, &folder), &origin, true) {
                        Ok((w, v)) => {
                            windows.insert(w.id(), (w, v));
                        }
                        Err(e) => fbcore::error!("Could not open a window for {}: {}", url, e),
                    }
                }
                Event::WindowEvent { window_id, event: WindowEvent::CloseRequested, .. } => {
                    if window_id == main_id {
                        if let Some(tx) = stop.take() {
                            let _ = tx.send(());
                        }
                        *control_flow = ControlFlow::Exit;
                    } else {
                        windows.remove(&window_id);
                    }
                }
                _ => {}
            }
        });
    }

    #[cfg(test)]
    mod tests {
        use super::{clean_folder, title_for};

        #[test]
        fn explorer_arguments() {
            assert_eq!(clean_folder("Z:\""), "Z:\\");
            assert_eq!(clean_folder("Z:"), "Z:\\");
            assert_eq!(clean_folder("C:\\Comics"), "C:\\Comics");
            assert_eq!(clean_folder("Z:\\."), "Z:\\");
            assert_eq!(clean_folder("C:\\Comics\\."), "C:\\Comics");
        }

        #[test]
        fn splash_icon_is_embedded() {
            let url = super::icon_data_url();
            assert!(url.starts_with("data:image/png;base64,") && url.len() > 1000, "{}", &url[..url.len().min(80)]);
        }

        #[test]
        fn window_icon_loads() {
            assert!(super::window_icon().is_some());
        }

        #[test]
        fn window_titles() {
            assert_eq!(title_for("http://localhost:3000/?file=99.my/clip%201.mp4", "Z:\\"), "File Browser - clip 1.mp4");
            assert_eq!(title_for("http://localhost:3000/", "Z:\\"), "File Browser - Z:\\");
        }
    }
}
