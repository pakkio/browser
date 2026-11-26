//! Helpers that reproduce the JavaScript / Node.js semantics the original server relied on:
//! `path.join` / `path.normalize` (which the `startsWith(baseDir)` security checks depend on),
//! `path.extname`, `decodeURIComponent`, UTF-16 string lengths, `Array.prototype.sort` order,
//! `localeCompare` and `Date.prototype.toISOString`.

use std::cmp::Ordering;
use std::time::SystemTime;

#[cfg(windows)]
pub const SEP: char = '\\';
#[cfg(not(windows))]
pub const SEP: char = '/';

#[inline]
fn is_sep(c: char) -> bool {
    if cfg!(windows) {
        c == '/' || c == '\\'
    } else {
        c == '/'
    }
}

/// Root of a path as Node sees it: `C:\`, `C:`, `\\server\share\`, `\` or `/`. Returns (root, rest, absolute).
fn split_root(p: &str) -> (String, &str, bool) {
    if cfg!(windows) {
        let b = p.as_bytes();
        // UNC: \\server\share\...
        if b.len() >= 2 && is_sep(b[0] as char) && is_sep(b[1] as char) {
            let rest = &p[2..];
            let mut parts = rest.splitn(3, is_sep);
            let server = parts.next().unwrap_or("");
            let share = parts.next();
            if !server.is_empty() {
                if let Some(share) = share {
                    if !share.is_empty() {
                        let consumed = 2 + server.len() + 1 + share.len();
                        let tail = &p[consumed.min(p.len())..];
                        let tail = tail.trim_start_matches(is_sep);
                        return (format!("\\\\{}\\{}\\", server, share), tail, true);
                    }
                }
            }
            return ("\\".to_string(), p.trim_start_matches(is_sep), true);
        }
        if b.len() >= 2 && (b[0] as char).is_ascii_alphabetic() && b[1] == b':' {
            let drive = &p[..2];
            let rest = &p[2..];
            if rest.starts_with(is_sep) {
                return (format!("{}\\", drive), rest.trim_start_matches(is_sep), true);
            }
            return (drive.to_string(), rest, false);
        }
        if p.starts_with(is_sep) {
            return ("\\".to_string(), p.trim_start_matches(is_sep), true);
        }
        (String::new(), p, false)
    } else if p.starts_with('/') {
        ("/".to_string(), p.trim_start_matches('/'), true)
    } else {
        (String::new(), p, false)
    }
}

/// Node's `path.normalize`.
pub fn normalize(p: &str) -> String {
    if p.is_empty() {
        return ".".to_string();
    }
    let (root, rest, absolute) = split_root(p);
    let trailing = p.ends_with(is_sep) && !rest.is_empty();
    let mut out: Vec<&str> = Vec::new();
    for seg in rest.split(is_sep) {
        match seg {
            "" | "." => {}
            ".." => {
                if matches!(out.last(), Some(last) if *last != "..") {
                    out.pop();
                } else if !absolute {
                    out.push("..");
                }
            }
            s => out.push(s),
        }
    }
    let sep = SEP.to_string();
    let mut tail = out.join(&sep);
    if tail.is_empty() && !absolute {
        tail = ".".to_string();
    }
    if trailing && !tail.is_empty() {
        tail.push(SEP);
    }
    format!("{}{}", root, tail)
}

/// Node's `path.join`.
pub fn join(parts: &[&str]) -> String {
    let joined: Vec<&str> = parts.iter().copied().filter(|s| !s.is_empty()).collect();
    if joined.is_empty() {
        return ".".to_string();
    }
    normalize(&joined.join(&SEP.to_string()))
}

pub fn is_absolute(p: &str) -> bool {
    split_root(p).2
}

/// Node's `path.resolve(base, p)` for an absolute `base`.
pub fn resolve(base: &str, p: &str) -> String {
    let r = if is_absolute(p) { normalize(p) } else { join(&[base, p]) };
    strip_trailing_sep(&r)
}

fn strip_trailing_sep(p: &str) -> String {
    let (root, rest, _) = split_root(p);
    if rest.is_empty() {
        return root;
    }
    p.trim_end_matches(is_sep).to_string()
}

/// Node's `path.basename`.
pub fn basename(p: &str) -> String {
    let (_, rest, _) = split_root(p);
    let trimmed = rest.trim_end_matches(is_sep);
    match trimmed.rfind(is_sep) {
        Some(i) => trimmed[i + 1..].to_string(),
        None => trimmed.to_string(),
    }
}

/// Node's `path.extname`.
pub fn extname(p: &str) -> String {
    let base = basename(p);
    match base.rfind('.') {
        Some(0) | None => String::new(),
        Some(i) => {
            if base.chars().all(|c| c == '.') {
                String::new()
            } else {
                base[i..].to_string()
            }
        }
    }
}

/// Lower-cased extension, the way the handlers compare it.
pub fn ext_lower(p: &str) -> String {
    extname(p).to_lowercase()
}

/// Node's `path.dirname`.
pub fn dirname(p: &str) -> String {
    let (root, rest, _) = split_root(p);
    let trimmed = rest.trim_end_matches(is_sep);
    match trimmed.rfind(is_sep) {
        Some(i) => {
            let head = trimmed[..i].trim_end_matches(is_sep);
            if head.is_empty() {
                if root.is_empty() { SEP.to_string() } else { root }
            } else {
                format!("{}{}", root, head)
            }
        }
        None => {
            if root.is_empty() {
                ".".to_string()
            } else {
                root
            }
        }
    }
}

/// Node's `path.relative(from, to)` for two absolute paths.
pub fn relative(from: &str, to: &str) -> String {
    let f = strip_trailing_sep(&normalize(from));
    let t = strip_trailing_sep(&normalize(to));
    let eq = |a: &str, b: &str| if cfg!(windows) { a.eq_ignore_ascii_case(b) } else { a == b };
    if eq(&f, &t) {
        return String::new();
    }
    let fs: Vec<&str> = f.split(is_sep).filter(|s| !s.is_empty()).collect();
    let ts: Vec<&str> = t.split(is_sep).filter(|s| !s.is_empty()).collect();
    let mut i = 0;
    while i < fs.len() && i < ts.len() && eq(fs[i], ts[i]) {
        i += 1;
    }
    let mut out: Vec<&str> = std::iter::repeat_n("..", fs.len() - i).collect();
    out.extend_from_slice(&ts[i..]);
    out.join(&SEP.to_string())
}

/// Real path of `p` (symlinks and mapped drives resolved), without the `\\?\` prefix.
pub fn realpath(p: &str) -> std::io::Result<String> {
    dunce::canonicalize(p).map(|pb| plain_path(&pb.to_string_lossy()))
}

/// Windows' verbatim forms as Node shows them: \\?\UNC\server\share -> \\server\share,
/// \\?\C:\x -> C:\x (dunce leaves network shares, such as mapped or RaiDrive drives, verbatim).
pub fn plain_path(p: &str) -> String {
    if let Some(rest) = p.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", rest);
    }
    match p.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => rest.to_string(),
        _ => p.to_string(),
    }
}

/// Strict `decodeURIComponent`: None where JavaScript would throw a URIError.
pub fn decode_uri_component(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None;
            }
            let hex = s.get(i + 1..i + 3)?;
            let v = u8::from_str_radix(hex, 16).ok()?;
            out.push(v);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// `decodeURIComponent` with the handlers' fallback: the raw value when decoding fails.
pub fn decode_or_raw(s: &str) -> String {
    decode_uri_component(s).unwrap_or_else(|| s.to_string())
}

/// `encodeURIComponent`.
pub fn encode_uri_component(s: &str) -> String {
    const KEEP: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
        .remove(b'-').remove(b'_').remove(b'.').remove(b'!').remove(b'~')
        .remove(b'*').remove(b'\'').remove(b'(').remove(b')');
    percent_encoding::utf8_percent_encode(s, KEEP).to_string()
}

/// `str.length` in JavaScript (UTF-16 code units).
pub fn js_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// `str.substring(0, n)` in JavaScript (UTF-16 code units; a split surrogate pair is dropped).
pub fn js_prefix(s: &str, n: usize) -> &str {
    let mut units = 0;
    for (i, c) in s.char_indices() {
        let w = c.len_utf16();
        if units + w > n {
            return &s[..i];
        }
        units += w;
    }
    s
}

/// The order of JavaScript's default `Array.prototype.sort()` (UTF-16 code units).
pub fn utf16_cmp(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// Approximation of `String.prototype.localeCompare` (ICU root collation): punctuation and
/// symbols before digits before letters, letters compared case- and accent-insensitively first,
/// then accents, then lower case before upper case.
pub fn locale_cmp(a: &str, b: &str) -> Ordering {
    fn class(c: char) -> u8 {
        if c.is_alphabetic() {
            3
        } else if c.is_numeric() {
            2
        } else if c.is_whitespace() {
            0
        } else {
            1
        }
    }
    fn fold(c: char) -> char {
        let base = match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' => 'a',
            'ç' | 'Ç' => 'c',
            'è' | 'é' | 'ê' | 'ë' | 'È' | 'É' | 'Ê' | 'Ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' | 'Ì' | 'Í' | 'Î' | 'Ï' => 'i',
            'ñ' | 'Ñ' => 'n',
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' => 'o',
            'ù' | 'ú' | 'û' | 'ü' | 'Ù' | 'Ú' | 'Û' | 'Ü' => 'u',
            'ý' | 'ÿ' | 'Ý' => 'y',
            _ => c,
        };
        base.to_lowercase().next().unwrap_or(base)
    }
    let primary = |s: &str| -> Vec<(u8, char)> { s.chars().map(|c| (class(c), fold(c))).collect() };
    let p = primary(a).cmp(&primary(b));
    if p != Ordering::Equal {
        return p;
    }
    let accents = |s: &str| -> Vec<char> { s.chars().flat_map(|c| c.to_lowercase()).collect() };
    let s = accents(a).cmp(&accents(b));
    if s != Ordering::Equal {
        return s;
    }
    // Tertiary: lower case sorts before upper case
    let case = |s: &str| -> Vec<bool> { s.chars().map(|c| c.is_uppercase()).collect() };
    case(a).cmp(&case(b))
}

/// `new Date(t).toISOString()`.
pub fn iso(t: SystemTime) -> String {
    let dt: chrono::DateTime<chrono::Utc> = t.into();
    dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

pub fn now_iso() -> String {
    iso(SystemTime::now())
}

/// Milliseconds since the epoch (`Date.getTime()`), as JavaScript would report it.
pub fn epoch_ms(t: SystemTime) -> i64 {
    match t.duration_since(SystemTime::UNIX_EPOCH) {
        Ok(d) => d.as_millis() as i64,
        Err(e) => -(e.duration().as_millis() as i64),
    }
}

pub fn now_ms() -> i64 {
    epoch_ms(SystemTime::now())
}

/// A JavaScript number as JSON: integral values without a fractional part.
pub fn jnum(v: f64) -> serde_json::Value {
    if v.is_finite() && v.fract() == 0.0 && v.abs() < 9.0e15 {
        serde_json::Value::from(v as i64)
    } else {
        serde_json::Number::from_f64(v).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null)
    }
}

/// `String(number)` in JavaScript for the values the handlers format.
pub fn num_to_string(v: f64) -> String {
    if v.is_finite() && v.fract() == 0.0 && v.abs() < 1e21 {
        format!("{}", v as i64)
    } else if v.is_nan() {
        "NaN".into()
    } else {
        format!("{}", v)
    }
}

/// `parseInt(s, 10)`: leading whitespace, optional sign, then digits; None for NaN.
pub fn parse_int(s: &str) -> Option<i64> {
    let t = s.trim_start();
    let (neg, digits) = match t.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, t.strip_prefix('+').unwrap_or(t)),
    };
    let n: String = digits.chars().take_while(|c| c.is_ascii_digit()).collect();
    if n.is_empty() {
        return None;
    }
    let v: i64 = n.parse().ok().or(if n.len() > 18 { Some(i64::MAX) } else { None })?;
    Some(if neg { -v } else { v })
}

/// `parseFloat(s)`: the longest numeric prefix; None for NaN.
pub fn parse_float(s: &str) -> Option<f64> {
    let t = s.trim_start();
    if let Some(rest) = t.strip_prefix("Infinity").or_else(|| t.strip_prefix("+Infinity")) {
        let _ = rest;
        return Some(f64::INFINITY);
    }
    if t.starts_with("-Infinity") {
        return Some(f64::NEG_INFINITY);
    }
    let bytes = t.as_bytes();
    let mut end = 0;
    let mut seen_digit = false;
    let mut seen_dot = false;
    let mut seen_exp = false;
    while end < bytes.len() {
        let c = bytes[end] as char;
        if c.is_ascii_digit() {
            seen_digit = true;
        } else if (c == '+' || c == '-') && (end == 0 || matches!(bytes[end - 1], b'e' | b'E')) {
        } else if c == '.' && !seen_dot && !seen_exp {
            seen_dot = true;
        } else if (c == 'e' || c == 'E') && seen_digit && !seen_exp {
            seen_exp = true;
        } else {
            break;
        }
        end += 1;
    }
    let mut candidate = &t[..end];
    while !candidate.is_empty() {
        if let Ok(v) = candidate.parse::<f64>() {
            return Some(v);
        }
        candidate = &candidate[..candidate.len() - 1];
    }
    None
}

/// Truthiness of a JSON value, as in `if (value)`.
pub fn truthy(v: Option<&serde_json::Value>) -> bool {
    use serde_json::Value;
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(true),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn join_normalizes_like_node_win32() {
        assert_eq!(join(&["C:\\base", "a/b"]), "C:\\base\\a\\b");
        assert_eq!(join(&["C:\\base", "../../etc"]), "C:\\etc");
        assert_eq!(join(&["C:\\base", ""]), "C:\\base");
        assert_eq!(join(&["C:\\base", "/x"]), "C:\\base\\x");
        assert_eq!(join(&["\\\\srv\\share\\dir", "..\\.."]), "\\\\srv\\share\\");
        assert_eq!(dirname("a/b/c.txt"), "a/b");
        assert_eq!(dirname("c.txt"), ".");
        assert_eq!(dirname("C:\\x"), "C:\\");
        assert_eq!(relative("C:\\base", "C:\\base\\a\\b.txt"), "a\\b.txt");
        assert_eq!(resolve("C:\\base", "sub"), "C:\\base\\sub");
    }

    #[test]
    #[cfg(not(windows))]
    fn join_normalizes_like_node_posix() {
        assert_eq!(join(&["/base", "a/b"]), "/base/a/b");
        assert_eq!(join(&["/base", "../../etc"]), "/etc");
        assert_eq!(dirname("a/b/c.txt"), "a/b");
        assert_eq!(relative("/base", "/base/a/b.txt"), "a/b.txt");
    }

    #[test]
    fn verbatim_paths_become_plain() {
        assert_eq!(plain_path(r"\\?\UNC\RaiDrive-x\MEGA\"), r"\\RaiDrive-x\MEGA\");
        assert_eq!(plain_path(r"\\?\C:\data"), r"C:\data");
        assert_eq!(plain_path(r"C:\data"), r"C:\data");
    }

    #[test]
    fn extname_matches_node() {
        assert_eq!(extname("a.TXT"), ".TXT");
        assert_eq!(extname(".bashrc"), "");
        assert_eq!(extname("a.tar.gz"), ".gz");
        assert_eq!(extname("a."), ".");
        assert_eq!(extname("noext"), "");
        assert_eq!(extname("dir.x/file"), "");
    }

    #[test]
    fn decode_uri_component_is_strict() {
        assert_eq!(decode_uri_component("a%20b").as_deref(), Some("a b"));
        assert_eq!(decode_uri_component("100%"), None);
        assert_eq!(decode_uri_component("%zz"), None);
        assert_eq!(decode_uri_component("%C3%A9").as_deref(), Some("é"));
        assert_eq!(decode_uri_component("%C3"), None);
    }

    #[test]
    fn js_numbers() {
        assert_eq!(parse_int("12abc"), Some(12));
        assert_eq!(parse_int("abc"), None);
        assert_eq!(parse_float("0.25x"), Some(0.25));
        assert_eq!(parse_float("x"), None);
        assert_eq!(num_to_string(0.5), "0.5");
        assert_eq!(num_to_string(3.0), "3");
    }

    #[test]
    fn locale_compare_orders_case_insensitively() {
        assert_eq!(locale_cmp("apple", "Banana"), Ordering::Less);
        assert_eq!(locale_cmp("a", "A"), Ordering::Less);
        assert_eq!(locale_cmp("_x", "a"), Ordering::Less);
        assert_eq!(locale_cmp("1", "a"), Ordering::Less);
    }

    #[test]
    fn js_prefix_counts_utf16() {
        assert_eq!(js_prefix("héllo", 2), "hé");
        assert_eq!(js_prefix("a😀b", 2), "a");
        assert_eq!(js_len("a😀b"), 4);
    }
}
