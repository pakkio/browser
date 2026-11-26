//! In-memory cookie sessions, like express-session with `saveUninitialized: false`:
//! a cookie is only issued once something is stored in the session.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{Request, State};
use axum::http::{header, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde_json::{Map, Value};
use sha2::Sha256;

use crate::app::AppRef;

const COOKIE: &str = "fb.sid";
const MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// Session data and when it expires.
type Entry = (Map<String, Value>, Instant);

#[derive(Default)]
pub struct SessionStore {
    entries: Mutex<HashMap<String, Entry>>,
}

#[derive(Default)]
struct Inner {
    id: Option<String>,
    data: Map<String, Value>,
    modified: bool,
    destroyed: bool,
    regenerate: bool,
}

/// Handle to the current request's session data.
#[derive(Clone, Default)]
pub struct Session(Arc<Mutex<Inner>>);

impl Session {
    pub fn get(&self, key: &str) -> Option<Value> {
        self.0.lock().unwrap().data.get(key).cloned()
    }
    pub fn get_str(&self, key: &str) -> Option<String> {
        self.get(key).and_then(|v| v.as_str().map(String::from))
    }
    pub fn set(&self, key: &str, value: Value) {
        let mut s = self.0.lock().unwrap();
        s.data.insert(key.to_string(), value);
        s.modified = true;
    }
    pub fn remove(&self, key: &str) {
        let mut s = self.0.lock().unwrap();
        if s.data.remove(key).is_some() {
            s.modified = true;
        }
    }
    pub fn destroy(&self) {
        let mut s = self.0.lock().unwrap();
        s.destroyed = true;
        s.data.clear();
    }
    /// New session id on login (protects against session fixation), keeping the data.
    pub fn regenerate(&self) {
        let mut s = self.0.lock().unwrap();
        s.regenerate = true;
        s.modified = true;
    }
}

fn secret() -> String {
    std::env::var("SESSION_SECRET").unwrap_or_else(|_| "dev-insecure-secret-do-not-use-production".into())
}

fn sign(id: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret().as_bytes()).expect("hmac key");
    mac.update(id.as_bytes());
    let sig = base64::Engine::encode(&base64::engine::general_purpose::STANDARD_NO_PAD, mac.finalize().into_bytes());
    format!("{}.{}", id, sig)
}

fn unsign(value: &str) -> Option<String> {
    let (id, _) = value.rsplit_once('.')?;
    let expected = sign(id);
    // Constant-time comparison
    if expected.len() == value.len() && expected.bytes().zip(value.bytes()).fold(0u8, |a, (x, y)| a | (x ^ y)) == 0 {
        Some(id.to_string())
    } else {
        None
    }
}

fn new_id() -> String {
    let mut buf = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, buf)
}

fn cookie_id(req: &Request) -> Option<String> {
    for value in req.headers().get_all(header::COOKIE) {
        let Ok(s) = value.to_str() else { continue };
        for part in s.split(';') {
            if let Some((k, v)) = part.trim().split_once('=') {
                if k == COOKIE {
                    let v = percent_encoding::percent_decode_str(v).decode_utf8_lossy();
                    if let Some(id) = unsign(&v) {
                        return Some(id);
                    }
                }
            }
        }
    }
    None
}

pub async fn middleware(State(app): State<AppRef>, mut req: Request, next: Next) -> Response {
    let mut inner = Inner::default();
    if let Some(id) = cookie_id(&req) {
        let mut store = app.sessions.entries.lock().unwrap();
        if let Some((data, expires)) = store.get(&id) {
            if *expires > Instant::now() {
                inner.id = Some(id.clone());
                inner.data = data.clone();
            } else {
                store.remove(&id);
            }
        }
    }
    let session = Session(Arc::new(Mutex::new(inner)));
    req.extensions_mut().insert(session.clone());

    let mut resp = next.run(req).await;

    let mut s = session.0.lock().unwrap();
    let mut store = app.sessions.entries.lock().unwrap();
    if s.destroyed {
        if let Some(id) = s.id.take() {
            store.remove(&id);
        }
        return resp;
    }
    if !s.modified {
        return resp;
    }
    if s.regenerate {
        if let Some(old) = s.id.take() {
            store.remove(&old);
        }
    }
    let id = s.id.clone().unwrap_or_else(new_id);
    store.insert(id.clone(), (s.data.clone(), Instant::now() + MAX_AGE));
    // Drop expired sessions now and then
    if store.len() % 64 == 0 {
        let now = Instant::now();
        store.retain(|_, (_, exp)| *exp > now);
    }
    let mut cookie = format!(
        "{}={}; Path=/; Max-Age={}; HttpOnly; SameSite=Lax",
        COOKIE,
        sign(&id),
        MAX_AGE.as_secs()
    );
    if app.production {
        cookie.push_str("; Secure");
    }
    if let Ok(v) = HeaderValue::from_str(&cookie) {
        resp.headers_mut().append(header::SET_COOKIE, v);
    }
    resp
}
