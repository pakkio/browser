//! Running external tools without a shell, streaming from blocking readers (zip / tar / rar),
//! per-key locks that stop concurrent duplicate work, and the hex dump used for unknown files.

use std::collections::HashMap;
use std::io::Write;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::{Body, Bytes};
use tokio::sync::{mpsc, oneshot};

// ---------------------------------------------------------------------------------------------
// External commands

pub struct CmdOutput {
    pub status: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub timed_out: bool,
}

impl CmdOutput {
    pub fn success(&self) -> bool {
        self.status == Some(0) && !self.timed_out
    }
    pub fn stdout_str(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
    pub fn stderr_str(&self) -> String {
        String::from_utf8_lossy(&self.stderr).into_owned()
    }
}

pub fn command(program: &str) -> tokio::process::Command {
    let mut c = tokio::process::Command::new(program);
    c.stdin(Stdio::null()).kill_on_drop(true);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: no console window flashes up for each tool run
        c.creation_flags(0x0800_0000);
    }
    c
}

/// Run a program to completion with a time limit. Err only when it cannot be started.
pub async fn run(program: &str, args: &[&str], timeout: Duration) -> std::io::Result<CmdOutput> {
    let child = command(program).args(args).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(out) => {
            let out = out?;
            Ok(CmdOutput { status: out.status.code(), stdout: out.stdout, stderr: out.stderr, timed_out: false })
        }
        Err(_) => Ok(CmdOutput { status: None, stdout: Vec::new(), stderr: Vec::new(), timed_out: true }),
    }
}

/// First program of `candidates` that can be started (e.g. gs, then gswin64c on Windows).
pub async fn run_first(candidates: &[&str], args: &[&str], timeout: Duration) -> std::io::Result<CmdOutput> {
    let mut last = std::io::Error::new(std::io::ErrorKind::NotFound, "no candidate");
    for c in candidates {
        match run(c, args, timeout).await {
            Ok(o) => return Ok(o),
            Err(e) => last = e,
        }
    }
    Err(last)
}

// ---------------------------------------------------------------------------------------------
// Streaming from a blocking reader

/// Writer handed to a blocking task; bytes go to the HTTP response as they are written.
pub struct StreamWriter {
    tx: mpsc::Sender<std::io::Result<Bytes>>,
    started: Option<oneshot::Sender<()>>,
    buf: Vec<u8>,
}

const CHUNK: usize = 64 * 1024;

impl StreamWriter {
    /// The entry was found: answer with headers now and stream the body from here on.
    pub fn start(&mut self) {
        if let Some(s) = self.started.take() {
            let _ = s.send(());
        }
    }
    fn send(&mut self) -> std::io::Result<()> {
        if self.buf.is_empty() {
            return Ok(());
        }
        let chunk = Bytes::from(std::mem::take(&mut self.buf));
        self.tx
            .blocking_send(Ok(chunk))
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::BrokenPipe, "client went away"))
    }
}

impl Write for StreamWriter {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        self.buf.extend_from_slice(data);
        if self.buf.len() >= CHUNK {
            self.send()?;
        }
        Ok(data.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.send()
    }
}

/// Run `f` on a blocking thread. When it calls `start()` (or returns Ok), the body streams what
/// it writes; when it fails before starting, its error is returned instead.
pub async fn blocking_stream<F>(f: F) -> Result<Body, String>
where
    F: FnOnce(&mut StreamWriter) -> Result<(), String> + Send + 'static,
{
    let (tx, mut rx) = mpsc::channel::<std::io::Result<Bytes>>(8);
    let (stx, srx) = oneshot::channel();
    let err_tx = tx.clone();
    let handle = tokio::task::spawn_blocking(move || {
        let mut w = StreamWriter { tx, started: Some(stx), buf: Vec::new() };
        let result = f(&mut w);
        match result {
            Ok(()) => {
                w.start();
                let _ = w.send();
                Ok(())
            }
            Err(e) => {
                if w.started.is_some() {
                    return Err(e);
                }
                let _ = w.send();
                // Already streaming: abort the response
                let _ = err_tx.blocking_send(Err(std::io::Error::other(e)));
                Ok(())
            }
        }
    });
    match srx.await {
        Ok(()) => {
            let stream = futures_util::stream::poll_fn(move |cx| rx.poll_recv(cx));
            Ok(Body::from_stream(stream))
        }
        Err(_) => match handle.await {
            Ok(Err(e)) => Err(e),
            Ok(Ok(())) => Ok(Body::empty()),
            Err(e) => Err(e.to_string()),
        },
    }
}

// ---------------------------------------------------------------------------------------------
// Per-key locks: concurrent requests for the same work wait for the first, then hit its cache

#[derive(Default)]
pub struct KeyedLocks {
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl KeyedLocks {
    pub async fn lock(&self, key: &str) -> KeyGuard<'_> {
        let m = {
            let mut map = self.locks.lock().unwrap();
            map.entry(key.to_string()).or_default().clone()
        };
        let guard = m.clone().lock_owned().await;
        KeyGuard { owner: self, key: key.to_string(), _guard: guard, arc: m }
    }
    pub fn len(&self) -> usize {
        self.locks.lock().unwrap().len()
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

pub struct KeyGuard<'a> {
    owner: &'a KeyedLocks,
    key: String,
    _guard: tokio::sync::OwnedMutexGuard<()>,
    arc: Arc<tokio::sync::Mutex<()>>,
}

impl Drop for KeyGuard<'_> {
    fn drop(&mut self) {
        let mut map = self.owner.locks.lock().unwrap();
        // Two references: the map's and ours; nobody else waits, so the entry can go
        if Arc::strong_count(&self.arc) <= 3 {
            map.remove(&self.key);
        }
    }
}

// ---------------------------------------------------------------------------------------------

/// Hex dump of the first bytes of a binary file: "0000: 4d5a 9000 ..." with 16 bytes per line.
pub fn hex_dump(data: &[u8]) -> String {
    let mut out = String::new();
    for (i, b) in data.iter().enumerate() {
        if i % 16 == 0 {
            if i > 0 {
                out.push('\n');
            }
            out.push_str(&format!("{:04x}: ", i & 0xffff));
        }
        out.push_str(&format!("{:02x}", b));
        if i % 2 == 1 {
            out.push(' ');
        }
    }
    out
}

/// Temporary folder for extracted files.
pub fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(name);
    let _ = std::fs::create_dir_all(&dir);
    dir
}

pub fn unique_name(name: &str) -> String {
    use rand::Rng;
    let id: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(8)
        .map(char::from)
        .collect();
    format!("{}_{}_{}", crate::jsutil::now_ms(), id.to_lowercase(), name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_dump_matches_original_format() {
        let d: Vec<u8> = (0u8..18).collect();
        assert_eq!(
            hex_dump(&d),
            "0000: 0001 0203 0405 0607 0809 0a0b 0c0d 0e0f \n0010: 1011 "
        );
        assert_eq!(hex_dump(&[]), "");
    }
}
