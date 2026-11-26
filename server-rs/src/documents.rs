//! EPUB cover / chapters (lib/epub-handlers.js) and DOCX thumbnails (file-handlers.js,
//! docx-text-preview.js).

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::sync::OnceLock;

use axum::extract::State;
use axum::http::header;
use axum::response::Response;
use regex::Regex;
use serde_json::{json, Value};

use crate::app::{bytes, json, json_status, AppRef, Ctx};
use crate::jsutil::{self, js_len, js_prefix};

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
}

macro_rules! rx {
    ($p:expr) => {{
        static CELL: OnceLock<Regex> = OnceLock::new();
        re(&CELL, $p)
    }};
}

/// `path.dirname(opfPath)` joined with an href the way the original built paths.
fn opf_join(opf_dir: &str, href: &str) -> String {
    if opf_dir == "." { href.to_string() } else { format!("{}/{}", opf_dir, href) }
}

/// Find the cover image path in an OPF package document. `strict_id_first` reproduces the
/// slightly different first pattern the preview endpoint used.
fn detect_cover(opf: &str, opf_dir: &str, preview_variant: bool) -> Option<String> {
    if let Some(m) = rx!(r#"(?i)<meta\s+name="cover"\s+content="([^"]+)""#).captures(opf) {
        let id = regex::escape(&m[1]);
        let found = if preview_variant {
            Regex::new(&format!(r#"(?i)<item\s+id="{}"[^>]*href="([^"]+)""#, id)).ok().and_then(|r| r.captures(opf))
        } else {
            Regex::new(&format!(r#"(?i)<item\s+[^>]*id="{}"[^>]*href="([^"]+)""#, id))
                .ok()
                .and_then(|r| r.captures(opf))
                .or_else(|| Regex::new(&format!(r#"(?i)<item\s+[^>]*href="([^"]+)"[^>]*id="{}""#, id)).ok().and_then(|r| r.captures(opf)))
        };
        if let Some(c) = found {
            return Some(opf_join(opf_dir, &c[1]));
        }
    }
    if let Some(c) = rx!(r#"(?i)<item[^>]*id="cover-image"[^>]*href="([^"]+)""#)
        .captures(opf)
        .or_else(|| rx!(r#"(?i)<item[^>]*href="([^"]+)"[^>]*id="cover-image""#).captures(opf))
    {
        return Some(opf_join(opf_dir, &c[1]));
    }
    let third = if preview_variant {
        rx!(r#"(?i)<item[^>]*id="[^"]*cover[^"]*"[^>]*href="([^"]+)""#)
    } else {
        rx!(r#"(?i)<item[^>]*id="[^"]*cover[^"]*"[^>]*href="([^"]+\.(jpe?g|png|gif))""#)
    };
    if let Some(c) = third.captures(opf) {
        return Some(opf_join(opf_dir, &c[1]));
    }
    rx!(r#"(?i)<item[^>]*media-type="image/[^"]*"[^>]*href="([^"]+)""#)
        .captures(opf)
        .map(|c| opf_join(opf_dir, &c[1]))
}

fn image_type(p: &str) -> &'static str {
    if p.to_lowercase().ends_with(".png") { "image/png" } else { "image/jpeg" }
}

// ---------------------------------------------------------------------------------------------
// GET /epub-cover

pub enum CoverResult {
    Found(Vec<u8>, &'static str),
    Missing { requested: String, images: Vec<String> },
}

pub fn read_cover(full: &str, cover: Option<String>) -> Result<CoverResult, String> {
    let mut z = crate::archives::open_zip(full).map_err(|e| e.to_string())?;
    // Central directory order, as yauzl reported it
    let ordered: Vec<String> = (0..z.len()).filter_map(|i| z.name_for_index(i).map(String::from)).collect();
    let is_image = |n: &str| rx!(r"(?i)\.(jpe?g|png|gif)$").is_match(n);
    let mut read = |name: &str| -> Option<Vec<u8>> {
        let mut f = z.by_name(name).ok()?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).ok()?;
        Some(buf)
    };
    if let Some(c) = &cover {
        if ordered.iter().any(|n| n == c) {
            if let Some(data) = read(c) {
                return Ok(CoverResult::Found(data, image_type(c)));
            }
        }
    } else if let Some(container) = read("META-INF/container.xml") {
        let container = String::from_utf8_lossy(&container).into_owned();
        if let Some(m) = rx!(r#"(?i)full-path="([^"]+)""#).captures(&container) {
            let opf_path = m[1].to_string();
            if opf_path.ends_with(".opf") {
                if let Some(opf) = read(&opf_path) {
                    let opf = String::from_utf8_lossy(&opf).into_owned();
                    if let Some(detected) = detect_cover(&opf, &jsutil::dirname(&opf_path), false) {
                        if is_image(&detected) {
                            if let Some(data) = read(&detected) {
                                return Ok(CoverResult::Found(data, image_type(&detected)));
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(CoverResult::Missing {
        requested: cover.unwrap_or_else(|| "auto-detect".into()),
        images: ordered.into_iter().filter(|n| is_image(n)).take(20).collect(),
    })
}

pub async fn epub_cover(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let Some(file_path) = ctx.q_nonempty("path") else {
        return json_status(400, &json!({ "error": "Missing file path" }));
    };
    let base = app.base_dir();
    let full = jsutil::join(&[&base, file_path]);
    if !full.starts_with(&base) {
        return json_status(403, &json!({ "error": "Forbidden" }));
    }
    if !Path::new(&full).exists() {
        return json_status(404, &json!({ "error": "File not found" }));
    }
    let cover = ctx.q_nonempty("cover").map(String::from);
    match tokio::task::spawn_blocking(move || read_cover(&full, cover)).await {
        Ok(Ok(CoverResult::Found(data, mime))) => {
            let mut r = bytes(200, mime, data);
            crate::app::set_header(&mut r, "cache-control", "public, max-age=86400");
            r
        }
        Ok(Ok(CoverResult::Missing { requested, images })) => json_status(
            404,
            &json!({ "error": "Cover image not found", "requestedPath": requested, "availableEntries": images }),
        ),
        Ok(Err(e)) => json_status(500, &json!({ "error": e })),
        Err(e) => json_status(500, &json!({ "error": e.to_string() })),
    }
}

// ---------------------------------------------------------------------------------------------
// GET /epub-preview

/// String.fromCharCode semantics: the value is truncated to 16 bits.
fn from_char_code(v: u64) -> String {
    let unit = (v & 0xffff) as u32;
    char::from_u32(unit).map(String::from).unwrap_or_else(|| "\u{fffd}".into())
}

/// The clean-up the original applied to chapter HTML before sending it to the reader.
pub fn clean_chapter(content: &str) -> String {
    let mut c = content.to_string();
    for r in [
        rx!(r"(?i)<script[\s\S]*?</script>"),
        rx!(r"(?i)<style[\s\S]*?</style>"),
        rx!(r"(?i)<head[\s\S]*?</head>"),
        rx!(r"(?i)</?html[^>]*>"),
        rx!(r"(?i)</?body[^>]*>"),
        rx!(r#"(?i)class="[^"]*""#),
        rx!(r#"(?i)style="[^"]*""#),
        rx!(r#"(?i)xmlns[^=]*="[^"]*""#),
        rx!(r"(?i)<\?xml[^>]*\?>"),
    ] {
        c = r.replace_all(&c, "").into_owned();
    }
    let mut c = c.trim().to_string();

    if js_len(&c) < 100 || !rx!(r"<[^>]+>").is_match(&c) {
        if let Some(m) = rx!(r"(?i)<body[^>]*>([\s\S]*?)</body>").captures(content) {
            let mut b = m[1].to_string();
            for r in [
                rx!(r"(?i)<script[\s\S]*?</script>"),
                rx!(r"(?i)<style[\s\S]*?</style>"),
                rx!(r#"(?i)class="[^"]*""#),
                rx!(r#"(?i)style="[^"]*""#),
            ] {
                b = r.replace_all(&b, "").into_owned();
            }
            c = b.trim().to_string();
        } else {
            c = content.trim().to_string();
        }
    }

    // Entities, including ones missing their semicolon
    c = rx!(r"&#(\d+);?")
        .replace_all(&c, |m: &regex::Captures| from_char_code(m[1].parse::<u64>().unwrap_or(u64::MAX)))
        .into_owned();
    c = rx!(r"&#x([a-fA-F0-9]+);?")
        .replace_all(&c, |m: &regex::Captures| from_char_code(u64::from_str_radix(&m[1], 16).unwrap_or(u64::MAX)))
        .into_owned();
    for (r, to) in [
        (rx!(r"&quot;?"), "\""),
        (rx!(r"&apos;?"), "'"),
        (rx!(r"&lt;?"), "<"),
        (rx!(r"&gt;?"), ">"),
        (rx!(r"&nbsp;?"), " "),
        (rx!(r"&amp;?"), "&"),
    ] {
        c = r.replace_all(&c, to).into_owned();
    }

    // Characters that broke the reader's typesetting
    let pairs: [(&Regex, &str); 22] = [
        (rx!("[\u{2018}\u{2019}]"), "'"),
        (rx!("[\u{201C}\u{201D}]"), "\""),
        (rx!("[\u{2013}\u{2014}]"), "--"),
        (rx!("\u{2026}"), "..."),
        (rx!("\u{00A0}"), " "),
        (rx!("\u{2022}"), "* "),
        (rx!("[\u{2020}\u{2021}]"), "*"),
        (rx!("[\u{2002}-\u{2009}\u{200A}\u{202F}\u{205F}]"), " "),
        (rx!("\u{200B}"), ""),
        (rx!("汉语水平考试"), "HSK"),
        (rx!("[\u{3000}-\u{303f}]"), " "),
        (rx!("[\u{4e00}-\u{9fff}]"), "[CJK]"),
        (rx!("[\u{3040}-\u{309f}]"), "[CJK]"),
        (rx!("[\u{30a0}-\u{30ff}]"), "[CJK]"),
        (rx!("[\u{ac00}-\u{d7af}]"), "[CJK]"),
        (rx!("[\u{2e80}-\u{2eff}]"), "[CJK]"),
        (rx!("[\u{2f00}-\u{2fdf}]"), "[CJK]"),
        (rx!("[\u{3400}-\u{4dbf}]"), "[CJK]"),
        (rx!("[\u{f900}-\u{faff}]"), "[CJK]"),
        (rx!("[\u{0080}-\u{009F}]"), ""),
        (rx!("[\u{F000}-\u{F8FF}]"), ""),
        (rx!("[\u{2100}-\u{214F}\u{2200}-\u{22FF}\u{2300}-\u{23FF}]"), ""),
    ];
    // The ideographic full stop, comma and corner brackets fall in U+3000-U+303F and became
    // spaces before their own replacements ran, so those replacements never matched.
    for (r, to) in pairs {
        c = r.replace_all(&c, to).into_owned();
    }

    if js_len(&c) > 50000 {
        c = format!("{}...\n\n<p><em>[Content truncated for performance]</em></p>", js_prefix(&c, 50000));
    }
    c
}

fn extract_epub(full: &str) -> Result<Value, String> {
    let mut z = crate::archives::open_zip(full).map_err(|e| e.to_string())?;
    let mut files: HashMap<String, String> = HashMap::new();
    for i in 0..z.len() {
        let Ok(mut f) = z.by_index(i) else { continue };
        let name = f.name().to_string();
        if name.ends_with('/') {
            continue;
        }
        let mut buf = Vec::new();
        if f.read_to_end(&mut buf).is_ok() {
            files.insert(name, String::from_utf8_lossy(&buf).into_owned());
        }
    }
    let container = files.get("META-INF/container.xml").ok_or("Missing container.xml")?;
    let opf_path = rx!(r#"(?i)full-path="([^"]+)""#).captures(container).ok_or("Could not find OPF file path")?[1].to_string();
    let opf = files.get(&opf_path).ok_or("Could not find OPF file")?;
    let opf_dir = jsutil::dirname(&opf_path);

    let field = |tag: &str| -> Value {
        Regex::new(&format!(r"(?i)<dc:{t}[^>]*>([^<]+)</dc:{t}>", t = tag))
            .ok()
            .and_then(|r| r.captures(opf).map(|c| Value::String(c[1].to_string())))
            .unwrap_or(Value::Null)
    };
    let cover_path = detect_cover(opf, &opf_dir, true);
    let metadata = json!({ "title": field("title"), "creator": field("creator"), "description": field("description"), "coverPath": cover_path });

    let mut spine: Vec<String> = Vec::new();
    if let Some(s) = rx!(r"(?i)<spine[^>]*>([\s\S]*?)</spine>").captures(opf) {
        for m in rx!(r#"(?i)<itemref[^>]*idref="([^"]+)""#).captures_iter(&s[1]) {
            spine.push(m[1].to_string());
        }
    }
    let mut manifest: HashMap<String, String> = HashMap::new();
    for item in rx!(r"(?i)<item[^>]+>").find_iter(opf) {
        let item = item.as_str();
        if let (Some(id), Some(href)) = (rx!(r#"(?i)id="([^"]+)""#).captures(item), rx!(r#"(?i)href="([^"]+)""#).captures(item)) {
            // Later duplicates win, as with Map.set
            manifest.insert(id[1].to_string(), href[1].to_string());
        }
    }

    let mut chapters: Vec<Value> = Vec::new();
    for id in spine.iter().take(20) {
        let Some(href) = manifest.get(id) else { continue };
        let Some(content) = files.get(&opf_join(&opf_dir, href)) else { continue };
        let title = rx!(r"(?i)<title[^>]*>([^<]+)</title>")
            .captures(content)
            .or_else(|| rx!(r"(?i)<h[1-6][^>]*>([^<]+)</h[1-6]>").captures(content))
            .map(|c| c[1].trim().to_string())
            .unwrap_or_else(|| format!("Chapter {}", chapters.len() + 1));
        chapters.push(json!({ "title": title, "content": clean_chapter(content) }));
    }
    if chapters.is_empty() {
        return Err("No readable chapters found".into());
    }
    let cover_image = cover_path.filter(|c| files.contains_key(c));
    Ok(json!({ "metadata": metadata, "chapters": chapters, "coverImage": cover_image }))
}

pub async fn epub_preview(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let Some(requested) = ctx.q_nonempty("path") else {
        return json_status(400, &json!({ "error": "File path is required" }));
    };
    let base = app.base_dir();
    let full = jsutil::join(&[&base, requested]);
    if !full.starts_with(&base) {
        return json_status(403, &json!({ "error": "Forbidden" }));
    }
    if !Path::new(&full).exists() {
        return json_status(404, &json!({ "error": "File not found" }));
    }
    if jsutil::ext_lower(&full) != ".epub" {
        return json_status(400, &json!({ "error": "Not an EPUB file" }));
    }
    match tokio::task::spawn_blocking(move || extract_epub(&full)).await {
        Ok(Ok(v)) => json(&v),
        Ok(Err(e)) => json_status(500, &json!({ "error": format!("EPUB extraction error: {}", e) })),
        Err(e) => json_status(500, &json!({ "error": format!("EPUB extraction error: {}", e) })),
    }
}

pub async fn cover_fallback() -> Response {
    json_status(
        404,
        &json!({
            "error": "Cover image not found. Images should use /epub-cover endpoint.",
            "hint": "This suggests a URL rewriting issue in EPUB content"
        }),
    )
}

pub async fn images_placeholder() -> Response {
    json_status(404, &json!({ "error": "Image endpoint not fully implemented yet" }))
}

// ---------------------------------------------------------------------------------------------
// GET /docx-preview

const MAX_XML_BYTES: u64 = 256 * 1024;

fn decode_xml(text: &str) -> String {
    rx!(r"(?i)&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);")
        .replace_all(text, |m: &regex::Captures| {
            let code = &m[1];
            if !code.starts_with('#') {
                return match code.to_lowercase().as_str() {
                    "amp" => "&",
                    "lt" => "<",
                    "gt" => ">",
                    "quot" => "\"",
                    _ => "'",
                }
                .to_string();
            }
            let point = if code[1..].to_lowercase().starts_with('x') {
                u32::from_str_radix(&code[2..], 16).ok()
            } else {
                code[1..].parse::<u32>().ok()
            };
            point.and_then(char::from_u32).map(String::from).unwrap_or_else(|| m[0].to_string())
        })
        .into_owned()
}

/// Plain text, one line per paragraph, from WordprocessingML (word/document.xml).
pub fn text_from_document_xml(xml: &str) -> String {
    let lines: Vec<String> = xml
        .split("</w:p>")
        .map(|para| {
            let mut line = String::new();
            for m in rx!(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>|<w:tab\s*/>").captures_iter(para) {
                match m.get(1) {
                    Some(t) => line.push_str(t.as_str()),
                    None => line.push(' '),
                }
            }
            decode_xml(&line)
        })
        .collect();
    rx!(r"\n{3,}").replace_all(&lines.join("\n"), "\n\n").trim().to_string()
}

/// 200x200 SVG card showing the first lines of `text`.
pub fn docx_text_svg(text: &str) -> String {
    let escape = |l: &str| l.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;");
    let lines: Vec<String> = js_prefix(text, 500).split('\n').take(12).map(|l| escape(js_prefix(l, 40))).collect();
    let elements: Vec<String> = lines
        .iter()
        .enumerate()
        .map(|(i, l)| {
            format!(
                "<text x=\"10\" y=\"{}\" fill=\"#333\" font-size=\"11\" font-family=\"Arial, sans-serif\">{}</text>",
                25 + i * 14,
                if l.is_empty() { " " } else { l }
            )
        })
        .collect();
    format!(
        r##"<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="#fff" stroke="#ddd" stroke-width="1"/>
  <rect x="5" y="5" width="190" height="30" fill="#2b579a" rx="2"/>
  <text x="10" y="25" fill="#fff" font-size="12" font-family="Arial, sans-serif" font-weight="bold">DOCX</text>
  <rect x="5" y="40" width="190" height="155" fill="#f9f9f9" rx="2"/>
  <g transform="translate(0, 25)">
    {}
  </g>
</svg>"##,
        elements.join("\n")
    )
}

pub enum Docx {
    Thumb(Vec<u8>, &'static str),
    Text(String),
    None,
}

pub fn docx_preview_blocking(full: &str) -> Docx {
    let Ok(mut z) = crate::archives::open_zip(full) else { return Docx::None };
    let names: Vec<String> = (0..z.len()).filter_map(|i| z.name_for_index(i).map(String::from)).collect();
    if let Some(name) = names.iter().find(|n| {
        let l = n.to_lowercase();
        l.starts_with("docprops/thumbnail.") || l == "thumbnail.jpeg" || l == "thumbnail.png"
    }) {
        if let Ok(mut f) = z.by_name(name) {
            let mut data = Vec::new();
            if f.read_to_end(&mut data).is_ok() {
                let l = name.to_lowercase();
                let mime = if l.ends_with(".png") {
                    "image/png"
                } else if l.ends_with(".wmf") {
                    "image/x-wmf"
                } else if l.ends_with(".emf") {
                    "image/x-emf"
                } else {
                    "image/jpeg"
                };
                return Docx::Thumb(data, mime);
            }
        }
    }
    let Ok(f) = z.by_name("word/document.xml") else { return Docx::None };
    let mut buf = Vec::new();
    if f.take(MAX_XML_BYTES).read_to_end(&mut buf).is_err() {
        return Docx::None;
    }
    let text = text_from_document_xml(&String::from_utf8_lossy(&buf));
    if text.is_empty() { Docx::None } else { Docx::Text(text) }
}

pub async fn docx_preview(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let Some(requested) = ctx.q_nonempty("path") else {
        return json_status(400, &json!({ "error": "File path is required" }));
    };
    let base = app.base_dir();
    let full = jsutil::join(&[&base, requested]);
    if !full.starts_with(&app.base_real()) && !full.starts_with(&base) {
        return json_status(403, &json!({ "error": "Forbidden" }));
    }
    if !Path::new(&full).exists() {
        return json_status(404, &json!({ "error": "File not found" }));
    }
    let ext = jsutil::ext_lower(&full);
    if ext != ".docx" && ext != ".doc" {
        return json_status(400, &json!({ "error": "Not a Word document" }));
    }
    let result = if ext == ".docx" {
        tokio::task::spawn_blocking(move || docx_preview_blocking(&full)).await.unwrap_or(Docx::None)
    } else {
        Docx::None
    };
    let mut resp = match result {
        Docx::Thumb(data, mime) => bytes(200, mime, data),
        Docx::Text(t) => bytes(200, "image/svg+xml", docx_text_svg(&t)),
        Docx::None => return json_status(404, &json!({ "error": "No thumbnail available" })),
    };
    resp.headers_mut().insert(header::CACHE_CONTROL, "public, max-age=86400".parse().unwrap());
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docx_text_extraction() {
        let xml = r#"<w:p><w:r><w:t>Hello</w:t><w:tab/><w:t xml:space="preserve">world &amp; co</w:t></w:r></w:p><w:p></w:p><w:p></w:p><w:p><w:t>Next</w:t></w:p>"#;
        assert_eq!(text_from_document_xml(xml), "Hello world & co\n\nNext");
    }

    #[test]
    fn chapter_cleanup() {
        let html = "<html><head><title>T</title></head><body><p class=\"x\">Caf&#233; \u{201C}q\u{201D} &amp;amp</p>".to_string()
            + &"<p>filler text</p>".repeat(10)
            + "</body></html>";
        let c = clean_chapter(&html);
        assert!(c.starts_with("<p >Café \"q\" &amp</p>"), "{}", c);
        assert!(!c.contains("<head>"));
    }

    #[test]
    fn epub_cover_detection() {
        let opf = r#"<metadata><meta name="cover" content="cov"/></metadata><manifest><item id="cov" href="images/c.jpg" media-type="image/jpeg"/></manifest>"#;
        assert_eq!(detect_cover(opf, "OEBPS", true).as_deref(), Some("OEBPS/images/c.jpg"));
        assert_eq!(detect_cover(opf, ".", false).as_deref(), Some("images/c.jpg"));
    }
}
