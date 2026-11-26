//! Security headers (same values helmet produced), per-IP rate limiting (express-rate-limit
//! with standard headers), the authentication gate, and local / private network checks.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{ConnectInfo, Request, State};
use axum::http::{HeaderName, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;
use serde_json::json;

use crate::app::{json_status, AppRef};

const MEGA_SOURCES: &str = "https://mega.nz https://*.mega.nz https://mega.io https://*.mega.io https://*.mega.co.nz";

fn csp() -> String {
    format!(
        "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';\
img-src 'self' data: blob: {m};object-src 'self';script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com;\
script-src-attr 'none';style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com;upgrade-insecure-requests;\
script-src-elem 'self' 'unsafe-inline' https://cdnjs.cloudflare.com;media-src 'self' blob: {m};connect-src 'self' {m};\
frame-src 'self' {m};worker-src 'self' blob: https://cdnjs.cloudflare.com",
        m = MEGA_SOURCES
    )
}

pub async fn helmet(req: Request, next: Next) -> Response {
    let mut resp = next.run(req).await;
    let h = resp.headers_mut();
    let set = |h: &mut axum::http::HeaderMap, k: &'static str, v: &str| {
        // A handler may set its own policy (mega.nz downloads are sandboxed); keep it
        if !h.contains_key(k) {
            h.insert(HeaderName::from_static(k), HeaderValue::from_str(v).unwrap());
        }
    };
    set(h, "content-security-policy", &csp());
    set(h, "cross-origin-opener-policy", "same-origin");
    set(h, "cross-origin-resource-policy", "same-origin");
    set(h, "origin-agent-cluster", "?1");
    set(h, "referrer-policy", "no-referrer");
    set(h, "strict-transport-security", "max-age=31536000; includeSubDomains");
    set(h, "x-content-type-options", "nosniff");
    set(h, "x-dns-prefetch-control", "off");
    set(h, "x-download-options", "noopen");
    set(h, "x-frame-options", "SAMEORIGIN");
    set(h, "x-permitted-cross-domain-policies", "none");
    set(h, "x-xss-protection", "0");
    resp
}

// ---------------------------------------------------------------------------------------------
// Rate limiting

pub struct RateLimiter {
    window: Duration,
    max: u32,
    hits: Mutex<HashMap<IpAddr, (Instant, u32)>>,
}

impl RateLimiter {
    pub fn new(window_secs: u64, max: u32) -> Arc<Self> {
        Arc::new(RateLimiter { window: Duration::from_secs(window_secs), max, hits: Mutex::new(HashMap::new()) })
    }
}

pub async fn rate_limit(State(limiter): State<Arc<RateLimiter>>, req: Request, next: Next) -> Response {
    let ip = req
        .extensions()
        .get::<ConnectInfo<std::net::SocketAddr>>()
        .map(|c| c.0.ip())
        .unwrap_or(IpAddr::from([0, 0, 0, 0]));
    let now = Instant::now();
    let (count, reset) = {
        let mut hits = limiter.hits.lock().unwrap();
        if hits.len() > 10_000 {
            hits.retain(|_, (start, _)| now.duration_since(*start) < limiter.window);
        }
        let entry = hits.entry(ip).or_insert((now, 0));
        if now.duration_since(entry.0) >= limiter.window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        let reset = limiter.window.saturating_sub(now.duration_since(entry.0)).as_secs_f64().ceil() as u64;
        (entry.1, reset)
    };
    let mut resp = if count > limiter.max {
        crate::app::text(429, "Too many requests, please try again later.")
    } else {
        next.run(req).await
    };
    let h = resp.headers_mut();
    let window = limiter.window.as_secs();
    h.insert("ratelimit-policy", HeaderValue::from_str(&format!("{};w={}", limiter.max, window)).unwrap());
    h.insert("ratelimit-limit", HeaderValue::from(limiter.max));
    h.insert("ratelimit-remaining", HeaderValue::from(limiter.max.saturating_sub(count)));
    h.insert("ratelimit-reset", HeaderValue::from(reset));
    if count > limiter.max {
        h.insert("retry-after", HeaderValue::from(reset));
    }
    resp
}

// ---------------------------------------------------------------------------------------------
// Authentication gate (auth.js requireAuth)

pub fn is_authenticated(session: &crate::session::Session) -> bool {
    session.get("user").map(|u| u.is_object()).unwrap_or(false)
}

pub async fn require_auth(State(app): State<AppRef>, req: Request, next: Next) -> Response {
    if !app.auth_enabled {
        return next.run(req).await;
    }
    let authed = req.extensions().get::<crate::session::Session>().map(is_authenticated).unwrap_or(false);
    if authed {
        return next.run(req).await;
    }
    unauthenticated(req.uri().path())
}

/// 401 JSON for API paths, a redirect to the sign-in page for anything else.
pub fn unauthenticated(p: &str) -> Response {
    let api = ["/api/", "/files", "/pdf-preview", "/comic-preview", "/epub-preview", "/video-transcode"]
        .iter()
        .any(|prefix| p.starts_with(prefix));
    if api {
        return json_status(401, &json!({ "error": "Authentication required", "loginUrl": "/auth/google" }));
    }
    Response::builder()
        .status(302)
        .header("location", "/auth/google")
        .header("content-type", "text/plain; charset=utf-8")
        .body("Found. Redirecting to /auth/google".into())
        .unwrap()
}

// ---------------------------------------------------------------------------------------------
// Network checks (utils/networkAccess.js)

/// True for the machine itself.
pub fn is_loopback(addr: &str) -> bool {
    matches!(addr, "127.0.0.1" | "::1" | "::ffff:127.0.0.1")
}

/// True for addresses on a private network: LAN, link-local, carrier-grade NAT (Tailscale and
/// similar VPNs), IPv6 unique-local / link-local. Public internet addresses are never private.
pub fn is_private_address(addr: &str) -> bool {
    if addr.is_empty() {
        return false;
    }
    let lower = addr.to_ascii_lowercase();
    let v4 = lower.strip_prefix("::ffff:").unwrap_or(&lower);
    let parts: Vec<&str> = v4.split('.').collect();
    if parts.len() == 4 && parts.iter().all(|p| !p.is_empty() && p.len() <= 3 && p.bytes().all(|b| b.is_ascii_digit())) {
        let n: Vec<u32> = parts.iter().map(|p| p.parse().unwrap()).collect();
        if n.iter().any(|&x| x > 255) {
            return false;
        }
        let (a, b) = (n[0], n[1]);
        return a == 10
            || (a == 172 && (16..=31).contains(&b))
            || (a == 192 && b == 168)
            || (a == 169 && b == 254)
            || (a == 100 && (64..=127).contains(&b))
            || a == 127;
    }
    let v6 = lower.split('%').next().unwrap_or("");
    if v6 == "::1" {
        return true;
    }
    let b = v6.as_bytes();
    let hex = |c: u8| c.is_ascii_hexdigit();
    // fc00::/7
    if b.len() >= 5 && b[0] == b'f' && (b[1] == b'c' || b[1] == b'd') && hex(b[2]) && hex(b[3]) && b[4] == b':' {
        return true;
    }
    // fe80::/10
    b.len() >= 5 && b[0] == b'f' && b[1] == b'e' && matches!(b[2], b'8' | b'9' | b'a' | b'b') && hex(b[3]) && b[4] == b':'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_addresses() {
        for a in ["10.0.0.1", "172.16.5.4", "192.168.1.10", "::ffff:192.168.1.10", "100.64.0.1", "fd12:3456::1", "fe80::1%eth0", "::1", "127.0.0.1"] {
            assert!(is_private_address(a), "{a}");
        }
        for a in ["8.8.8.8", "172.32.0.1", "100.128.0.1", "2001:db8::1", "", "999.1.1.1", "192.168.1"] {
            assert!(!is_private_address(a), "{a}");
        }
    }

    #[test]
    fn loopback() {
        assert!(is_loopback("::ffff:127.0.0.1"));
        assert!(!is_loopback("192.168.1.2"));
    }
}
