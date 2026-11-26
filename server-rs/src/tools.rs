//! The external tools the installer downloads (installer/tools-manifest.json) into
//! %LOCALAPPDATA%\FileBrowser\tools\<name>-<version>: put the installed ones on this process's
//! PATH, and tell whether any is missing.

use std::path::{Path, PathBuf};

use serde_json::Value;

fn tools_root() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join("FileBrowser").join("tools"))
}

/// The manifest: next to the install folder's launchers, or in installer/ of a source checkout.
pub fn manifest_path(app_dir: &Path) -> Option<PathBuf> {
    [app_dir.join("..").join("tools-manifest.json"), app_dir.join("installer").join("tools-manifest.json")]
        .into_iter()
        .find(|p| p.is_file())
}

/// True when every command of `alternatives` ("gs|gswin64c" = either) is found on PATH.
fn on_path(commands: &[Value]) -> bool {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
    commands.iter().filter_map(Value::as_str).all(|alternatives| {
        alternatives.split('|').any(|c| {
            let exe = if cfg!(windows) { format!("{}.exe", c) } else { c.to_string() };
            dirs.iter().any(|d| d.join(&exe).is_file())
        })
    })
}

/// Add the downloaded tools to PATH (and FB_NODE for the mega.nz helper). Returns true when a
/// tool that every install should have is neither downloaded nor installed on the machine.
pub fn setup(app_dir: &Path) -> bool {
    let (Some(manifest), Some(root)) = (manifest_path(app_dir), tools_root()) else { return false };
    let Ok(text) = std::fs::read_to_string(&manifest) else { return false };
    let Ok(m) = serde_json::from_str::<Value>(&text) else { return false };
    let mut add: Vec<PathBuf> = Vec::new();
    let mut missing = false;
    for tool in m["tools"].as_array().cloned().unwrap_or_default() {
        let dest = root.join(format!("{}-{}", tool["name"].as_str().unwrap_or(""), tool["version"].as_str().unwrap_or("")));
        if dest.is_dir() {
            for d in tool["dirs"].as_array().cloned().unwrap_or_default() {
                let dir = d.as_str().map(|s| dest.join(s)).unwrap_or_else(|| dest.clone());
                add.push(dir);
            }
            if tool["name"] == "node" && std::env::var_os("FB_NODE").is_none() {
                std::env::set_var("FB_NODE", dest.join("node.exe"));
            }
        } else if tool.get("feature").is_none() && !on_path(tool["commands"].as_array().map(Vec::as_slice).unwrap_or(&[])) {
            missing = true;
        }
    }
    if !add.is_empty() {
        let current = std::env::var_os("PATH").unwrap_or_default();
        let joined = std::env::join_paths(add.iter().cloned().chain(std::env::split_paths(&current)));
        if let Ok(p) = joined {
            std::env::set_var("PATH", p);
        }
    }
    missing
}

/// Start the installer's tool download (with its progress window) without waiting for it.
pub fn fetch_in_background(app_dir: &Path) -> Option<std::process::Child> {
    let script = app_dir.join("..").join("fetch-tools.ps1");
    if !script.is_file() {
        return None;
    }
    let mut cmd = std::process::Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-WindowStyle", "Hidden", "-File"])
        .arg(&script)
        .arg("-Gui")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.spawn().ok()
}
