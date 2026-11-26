//! Comic panel detection for guided reading (lib/comic-panels.js, panel-gutters.js,
//! panel-decisions.js): gutters first (no AI), then an OpenRouter decision model, then vision LLMs.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::response::Response;
use base64::Engine;
use serde_json::{json, Map, Value};
use sha1::{Digest, Sha1};

use crate::ai::{Analyzer, Options};
use crate::app::{json as json_resp, json_status, AppRef, Ctx};

// ---------------------------------------------------------------------------------------------
// Tier 1: gutters

const GRID_SIDE: usize = 500;
const BACKGROUND_TOLERANCE: i32 = 28;
const GUTTER_INK: f64 = 0.012;
const GUTTER_SIZE: f64 = 0.012;
const MIN_SIDE: f64 = 0.03;
const MIN_AREA: f64 = 0.015;
const MAX_GUTTER_PANELS: usize = 12;
const MIN_COVERAGE: f64 = 0.35;
const FULL_PAGE_AREA: f64 = 0.7;

#[derive(Clone, Copy, Debug)]
struct Bx {
    x0: usize,
    y0: usize,
    x1: usize,
    y1: usize,
    gw: usize,
    gh: usize,
}

fn round4(v: f64) -> f64 {
    // Math.round: halves go up
    (v * 10000.0 + 0.5).floor() / 10000.0
}

/// Ink fraction of every row ('y') or column ('x') of a box.
fn profile(ink: &[u8], w: usize, b: &Bx, rows: bool) -> Vec<f64> {
    let n = if rows { b.y1 - b.y0 } else { b.x1 - b.x0 };
    let mut out = vec![0usize; n];
    for y in b.y0..b.y1 {
        for x in b.x0..b.x1 {
            if ink[y * w + x] != 0 {
                out[if rows { y - b.y0 } else { x - b.x0 }] += 1;
            }
        }
    }
    let len = if rows { b.x1 - b.x0 } else { b.y1 - b.y0 } as f64;
    out.into_iter().map(|c| c as f64 / len).collect()
}

/// Runs of content, split wherever a gap of at least `min_gap` cells separates them.
fn spans(values: &[f64], min_gap: Option<usize>) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    let mut last = 0usize;
    for (i, &v) in values.iter().enumerate() {
        if v <= GUTTER_INK {
            continue;
        }
        if let (Some(s), Some(g)) = (start, min_gap) {
            if i - last > g {
                out.push((s, last + 1));
                start = None;
            }
        }
        if start.is_none() {
            start = Some(i);
        }
        last = i;
    }
    if let Some(s) = start {
        out.push((s, last + 1));
    }
    out
}

fn trim(ink: &[u8], w: usize, b: Bx) -> Option<Bx> {
    let rows = spans(&profile(ink, w, &b, true), None);
    let r = rows.first()?;
    let rt = Bx { y0: b.y0 + r.0, y1: b.y0 + r.1, ..b };
    let cols = spans(&profile(ink, w, &rt, false), None);
    let c = cols.first()?;
    Some(Bx { x0: b.x0 + c.0, x1: b.x0 + c.1, ..rt })
}

fn cut(ink: &[u8], w: usize, b: Bx, rows: bool) -> Vec<Bx> {
    let side = if rows { b.gh } else { b.gw } as f64;
    let min_gap = ((side * GUTTER_SIZE + 0.5).floor() as usize).max(2);
    spans(&profile(ink, w, &b, rows), Some(min_gap))
        .into_iter()
        .map(|(a, e)| if rows { Bx { y0: b.y0 + a, y1: b.y0 + e, ..b } } else { Bx { x0: b.x0 + a, x1: b.x0 + e, ..b } })
        .collect()
}

/// X-Y cut: split along row gutters, then column gutters, until no gutter is left.
fn split(ink: &[u8], w: usize, b: Bx, rows: bool, leaves: &mut Vec<Bx>, other_tried: bool) {
    let Some(inner) = trim(ink, w, b) else { return };
    let parts = cut(ink, w, inner, rows);
    if parts.len() > 1 {
        for p in parts {
            split(ink, w, p, !rows, leaves, false);
        }
    } else if !other_tried {
        split(ink, w, inner, !rows, leaves, true);
    } else {
        leaves.push(inner);
    }
}

/// Panels found from the gutters between them, as fractions of the page in reading order; None
/// when the layout is not clear enough to trust.
pub fn detect_by_gutters(jpeg: &[u8]) -> Option<Vec<Value>> {
    let img = image::load_from_memory_with_format(jpeg, image::ImageFormat::Jpeg).ok()?.to_rgb8();
    let (width, height) = (img.width() as usize, img.height() as usize);
    let step = (width.max(height) / GRID_SIDE).max(1);
    let (w, h) = (width / step, height / step);
    if w < 20 || h < 20 {
        return None;
    }
    let raw = img.as_raw();
    let mut gray = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            let i = ((y * step) * width + x * step) * 3;
            let g = (raw[i] as u32 * 299 + raw[i + 1] as u32 * 587 + raw[i + 2] as u32 * 114) / 1000;
            gray[y * w + x] = g as u8;
        }
    }
    // Background: median gray of the outer ring of the page
    let ring = ((w.min(h) as f64 * 0.02 + 0.5).floor() as usize).max(1);
    let mut levels: Vec<u8> = Vec::new();
    for y in 0..h {
        for x in 0..w {
            if x < ring || y < ring || x >= w - ring || y >= h - ring {
                levels.push(gray[y * w + x]);
            }
        }
    }
    levels.sort_unstable();
    let background = levels[levels.len() >> 1] as i32;
    let ink: Vec<u8> = gray.iter().map(|&g| ((g as i32 - background).abs() > BACKGROUND_TOLERANCE) as u8).collect();
    let ratio = ink.iter().filter(|&&v| v != 0).count() as f64 / ink.len() as f64;
    if !(0.02..=0.97).contains(&ratio) {
        return None;
    }
    let mut leaves = Vec::new();
    split(&ink, w, Bx { x0: 0, y0: 0, x1: w, y1: h, gw: w, gh: h }, true, &mut leaves, false);
    let (wf, hf) = (w as f64, h as f64);
    let panels: Vec<[f64; 4]> = leaves
        .iter()
        .map(|b| [b.x0 as f64 / wf, b.y0 as f64 / hf, (b.x1 - b.x0) as f64 / wf, (b.y1 - b.y0) as f64 / hf])
        .filter(|p| p[2] >= MIN_SIDE && p[3] >= MIN_SIDE && p[2] * p[3] >= MIN_AREA)
        .map(|p| [round4(p[0]), round4(p[1]), round4(p[2]), round4(p[3])])
        .collect();
    if panels.is_empty() || panels.len() > MAX_GUTTER_PANELS {
        return None;
    }
    if panels.len() == 1 && panels[0][2] * panels[0][3] >= FULL_PAGE_AREA {
        return None;
    }
    if panels.iter().map(|p| p[2] * p[3]).sum::<f64>() < MIN_COVERAGE {
        return None;
    }
    Some(panels.into_iter().map(|p| panel_json(p[0], p[1], p[2], p[3])).collect())
}

fn panel_json(x: f64, y: f64, w: f64, h: f64) -> Value {
    use crate::jsutil::jnum;
    json!({ "x": jnum(x), "y": jnum(y), "w": jnum(w), "h": jnum(h) })
}

// ---------------------------------------------------------------------------------------------
// Tier 2: OpenRouter decision model

const DECISIONS_ENDPOINT: &str = "https://openrouter.ai/api/alpha/decisions";
const MAX_ASKED: usize = 8;
const SAME_PANEL_OVERLAP: f64 = 0.8;

fn decision_questions() -> Value {
    let mut q = Map::new();
    for i in 1..=MAX_ASKED {
        q.insert(
            format!("panel{}", i),
            json!({ "type": "box", "instructions": format!("panel number {} of the comic page in reading order (top row first, left to right), the whole frame including its border", i) }),
        );
        q.insert(
            format!("exists{}", i),
            json!({ "type": "noul", "instructions": format!("The comic page has at least {} panel{}.", i, if i > 1 { "s" } else { "" }) }),
        );
    }
    Value::Object(q)
}

fn overlap(a: &[f64; 4], b: &[f64; 4]) -> f64 {
    let w = (a[0] + a[2]).min(b[0] + b[2]) - a[0].max(b[0]);
    let h = (a[1] + a[3]).min(b[1] + b[3]) - a[1].max(b[1]);
    if w <= 0.0 || h <= 0.0 {
        return 0.0;
    }
    (w * h) / (a[2] * a[3]).min(b[2] * b[3])
}

pub fn parse_decisions(answers: &Value) -> Option<Vec<Value>> {
    if answers.is_null() {
        return None;
    }
    let mut panels: Vec<[f64; 4]> = Vec::new();
    for i in 1..=MAX_ASKED {
        if !(answers[format!("exists{}", i)]["noul"].as_f64().unwrap_or(-1.0) >= 0.5) {
            break;
        }
        let b = &answers[format!("panel{}", i)]["box"];
        if !b.is_object() {
            break;
        }
        let n = |k: &str| b[k].as_f64().unwrap_or(f64::NAN);
        let x = n("left").clamp(0.0, 1.0);
        let y = n("top").clamp(0.0, 1.0);
        let p = [x, y, n("right").min(1.0) - x, n("bottom").min(1.0) - y];
        if !p.iter().all(|v| v.is_finite()) || p[2] < MIN_SIDE || p[3] < MIN_SIDE {
            continue;
        }
        if panels.iter().any(|q| overlap(q, &p) >= SAME_PANEL_OVERLAP) {
            continue;
        }
        panels.push([x, y, round4(p[2]), round4(p[3])]);
    }
    if panels.is_empty() || (panels.len() == 1 && panels[0][2] * panels[0][3] >= FULL_PAGE_AREA) {
        return None;
    }
    Some(panels.into_iter().map(|p| panel_json(p[0], p[1], p[2], p[3])).collect())
}

// ---------------------------------------------------------------------------------------------
// Tier 3: vision LLMs

const MAX_PANELS: usize = 20;
const PROMPT: &str = "This is one page of a comic book. Find every panel (frame) on the page.
Answer with JSON only, in this exact shape:
{\"panels\":[{\"x\":0.0,\"y\":0.0,\"w\":1.0,\"h\":1.0}]}
x and y are the top-left corner of the panel and w and h its width and height, all as fractions of the image width and height (0 to 1).
List the panels in reading order: top row first, left to right within a row.
A cover, a splash page or a full-page illustration is a single panel covering the illustrated area.
Ignore speech balloons, captions and page margins: they are part of a panel, not panels of their own.";

fn js_number(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) if s.trim().is_empty() => 0.0,
        Value::String(s) => s.trim().parse().unwrap_or(f64::NAN),
        Value::Bool(b) => *b as u8 as f64,
        Value::Null => 0.0,
        _ => f64::NAN,
    }
}

/// The panel list in a model reply, clamped to the image; None when unusable.
pub fn parse_panels(content: &str) -> Option<Vec<Value>> {
    let cleaned = regex::Regex::new(r"(?i)```(?:json)?").unwrap().replace_all(content, "");
    let m = regex::Regex::new(r"\{[\s\S]*\}").unwrap().find(&cleaned)?;
    let parsed: Value = serde_json::from_str(m.as_str()).ok()?;
    let list = parsed.get("panels")?.as_array()?;
    let mut out = Vec::new();
    for p in list.iter().take(MAX_PANELS) {
        let x = js_number(&p["x"]).clamp(0.0, 1.0);
        let y = js_number(&p["y"]).clamp(0.0, 1.0);
        let w = (1.0 - x).min(js_number(&p["w"]));
        let h = (1.0 - y).min(js_number(&p["h"]));
        if [x, y, w, h].iter().all(|v| v.is_finite()) && w >= MIN_SIDE && h >= MIN_SIDE {
            out.push(panel_json(x, y, w, h));
        }
    }
    (!out.is_empty()).then_some(out)
}

fn is_full_page(panels: &[Value]) -> bool {
    panels.len() == 1 && panels[0]["w"].as_f64().unwrap_or(0.0) * panels[0]["h"].as_f64().unwrap_or(0.0) >= FULL_PAGE_AREA
}

fn is_usage_limit(e: &str) -> bool {
    e.to_lowercase().contains("usage limit")
}

fn is_auth_error(e: &str) -> bool {
    regex::Regex::new(r"(?i)user not found|invalid api key|incorrect api key|unauthorized|authentication").unwrap().is_match(e)
}

/// Milliseconds until the quota resets ("resets in 3h 12m"); 10 minutes when unknown.
fn reset_delay(e: &str) -> Duration {
    let re = regex::Regex::new(r"(?i)resets in (?:(\d+)h)?\s*(?:(\d+)m)?").unwrap();
    let minutes = re
        .captures(e)
        .map(|c| c.get(1).map(|m| m.as_str().parse::<u64>().unwrap_or(0)).unwrap_or(0) * 60 + c.get(2).map(|m| m.as_str().parse::<u64>().unwrap_or(0)).unwrap_or(0))
        .unwrap_or(0);
    Duration::from_secs(if minutes == 0 { 10 } else { minutes } * 60)
}

#[derive(Default)]
pub struct PanelState {
    opencodego_blocked_until: Mutex<Option<Instant>>,
    openrouter_rejected: Mutex<Option<(Instant, String)>>,
    decisions_blocked_until: Mutex<Option<Instant>>,
}

struct Found {
    panels: Vec<Value>,
    model: Value,
}

/// Ask the models in turn until one gives usable panels. A single full-page panel from a light
/// model is often a miss, so the strong model (when given) is asked once and wins.
async fn ask_models(a: &Analyzer, messages: &Value, models: Vec<Option<String>>, strong: Option<String>) -> (Option<Found>, String) {
    let mut queue: std::collections::VecDeque<Option<String>> = models.into();
    let mut full_page: Option<Found> = None;
    let mut last_error = "No AI provider configured".to_string();
    while let Some(model) = queue.pop_front() {
        let r = a
            .request(messages, &Options { model: model.clone(), temperature: Some(0.1), max_tokens: Some(4000), json_object: true })
            .await;
        let panels = if r.success { r.content.as_deref().and_then(parse_panels) } else { None };
        if let Some(panels) = panels {
            let found = Found { panels, model: r.stats.as_ref().map(|s| s["model"].clone()).unwrap_or(Value::Null) };
            if let Some(s) = strong.as_ref() {
                if is_full_page(&found.panels) && full_page.is_none() && model.as_ref() != Some(s) {
                    crate::info!("Comic panel detection: one full-page panel, asking {}", s);
                    full_page = Some(found);
                    let rest: Vec<_> = queue.drain(..).filter(|m| m.as_ref() != Some(s)).collect();
                    queue.push_back(Some(s.clone()));
                    queue.extend(rest);
                    continue;
                }
            }
            return (Some(found), last_error);
        }
        last_error = if r.success { "The AI reply held no usable panels".into() } else { r.error.unwrap_or_default() };
        crate::warn!("Comic panel detection with {} failed: {}", model.as_deref().unwrap_or("default model"), last_error);
        // Every model shares the provider's quota
        if is_usage_limit(&last_error) {
            break;
        }
    }
    (full_page, last_error)
}

fn cache_dir() -> std::path::PathBuf {
    crate::cache::home_dir().join(".browser").join("cache").join("comic-panels")
}

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}

async fn decisions(app: &crate::app::App, image: &[u8]) -> Option<Vec<Value>> {
    let model = env("AI_VISION_DECISION_MODEL")?;
    let key = env("OPENROUTER_API_KEY")?.trim().to_string();
    if app.panels.decisions_blocked_until.lock().unwrap().map(|t| Instant::now() < t).unwrap_or(false) {
        return None;
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(image);
    let body = json!({
        "model": model,
        "state": ["One page of a comic book:", { "type": "image_url", "image_url": { "url": format!("data:image/jpeg;base64,{}", b64) } }],
        "questions": decision_questions(),
    });
    let resp = app.http.post(DECISIONS_ENDPOINT).bearer_auth(&key).json(&body).timeout(Duration::from_secs(20)).send().await;
    match resp {
        Ok(r) if r.status().is_success() => {
            let v: Value = r.json().await.ok()?;
            parse_decisions(&v["answers"])
        }
        Ok(r) => {
            *app.panels.decisions_blocked_until.lock().unwrap() = Some(Instant::now() + Duration::from_secs(600));
            crate::warn!("Comic panel decision model {} answered {}, pausing it for 10 minutes", model, r.status().as_u16());
            None
        }
        Err(e) => {
            crate::warn!("Comic panel decision request failed: {}", e);
            None
        }
    }
}

// POST /api/comic-panels (body: the page as image/jpeg)
pub async fn detect(State(app): State<AppRef>, ctx: Ctx) -> Response {
    let ctype = ctx.header("content-type").unwrap_or("").to_lowercase();
    if ctx.raw.len() > 6 * 1024 * 1024 {
        return axum::response::IntoResponse::into_response(crate::app::ApiError::new(413, "request entity too large"));
    }
    if !ctype.starts_with("image/jpeg") || ctx.raw.is_empty() {
        return json_status(400, &json!({ "error": "A JPEG page image is required" }));
    }
    let image = ctx.raw.to_vec();
    let hash = hex::encode(Sha1::digest(&image));
    let cache_file = cache_dir().join(format!("{}.json", hash));
    if let Ok(raw) = tokio::fs::read_to_string(&cache_file).await {
        if let Ok(v) = serde_json::from_str::<Value>(&raw) {
            return json_resp(&json!({ "panels": v["panels"], "cached": true }));
        }
    }
    let save = |panels: &Vec<Value>| {
        let _ = std::fs::create_dir_all(cache_dir());
        let _ = std::fs::write(&cache_file, serde_json::to_string(&json!({ "panels": panels })).unwrap_or_default());
    };

    if env("COMIC_PANELS_GUTTERS").as_deref() != Some("false") {
        let img = image.clone();
        if let Ok(Some(panels)) = tokio::task::spawn_blocking(move || detect_by_gutters(&img)).await {
            save(&panels);
            return json_resp(&json!({ "panels": panels, "cached": false, "source": "gutters" }));
        }
    }
    if let Some(panels) = decisions(&app, &image).await {
        save(&panels);
        return json_resp(&json!({ "panels": panels, "cached": false, "source": "decision", "model": env("AI_VISION_DECISION_MODEL") }));
    }

    let mut a = Analyzer::new(app.http.clone());
    let openrouter_first = env("AI_VISION_PROVIDER").as_deref() == Some("openrouter") && a.openrouter_key.is_some();
    if openrouter_first {
        a.provider = "openrouter".into();
    } else if a.opencodego_key.is_some() {
        a.provider = "opencodego".into();
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&image);
    let messages = json!([{ "role": "user", "content": [
        { "type": "text", "text": PROMPT },
        { "type": "image_url", "image_url": { "url": format!("data:image/jpeg;base64,{}", b64) } }
    ]}]);
    let models: Vec<Option<String>> = if a.provider == "opencodego" {
        let mut seen: Vec<String> = Vec::new();
        for m in [env("AI_VISION_MODEL"), Some(a.opencodego_model.clone())].into_iter().flatten().chain(a.opencodego_fallbacks.clone()) {
            if !m.is_empty() && !seen.contains(&m) {
                seen.push(m);
            }
        }
        seen.into_iter().map(Some).collect()
    } else {
        vec![if openrouter_first { env("AI_VISION_OPENROUTER_MODEL") } else { env("AI_VISION_MODEL") }]
    };
    let can_use_openrouter = a.provider == "opencodego" && a.openrouter_key.is_some();
    let blocked = a.provider == "opencodego"
        && app.panels.opencodego_blocked_until.lock().unwrap().map(|t| Instant::now() < t).unwrap_or(false);
    let (mut found, mut last_error) = if blocked {
        (None, "OpenCode Go usage limit reached".to_string())
    } else {
        let strong = if openrouter_first { env("AI_VISION_OPENROUTER_STRONG_MODEL") } else { env("AI_VISION_STRONG_MODEL") };
        ask_models(&a, &messages, models, strong).await
    };

    // OpenCode Go's quota is spent: remember it and carry on with OpenRouter
    if found.is_none() && a.provider == "opencodego" && is_usage_limit(&last_error) {
        if !blocked {
            *app.panels.opencodego_blocked_until.lock().unwrap() = Some(Instant::now() + reset_delay(&last_error));
        }
        let rejected = app.panels.openrouter_rejected.lock().unwrap().clone().filter(|(t, _)| Instant::now() < *t);
        if can_use_openrouter {
            if let Some((_, msg)) = rejected {
                last_error = msg;
            } else {
                crate::warn!("OpenCode Go usage limit reached, using OpenRouter for comic panels");
                a.provider = "openrouter".into();
                let model = env("AI_VISION_OPENROUTER_MODEL").unwrap_or_else(|| a.openrouter_model.clone());
                let (f, e) = ask_models(&a, &messages, vec![Some(model)], env("AI_VISION_OPENROUTER_STRONG_MODEL")).await;
                found = f;
                last_error = e;
                if found.is_none() && is_auth_error(&last_error) {
                    *app.panels.openrouter_rejected.lock().unwrap() = Some((Instant::now() + Duration::from_secs(600), last_error.clone()));
                }
            }
        }
    }

    if let Some(f) = found {
        save(&f.panels);
        return json_resp(&json!({ "panels": f.panels, "cached": false, "model": f.model }));
    }
    if is_auth_error(&last_error) {
        let detail = regex::Regex::new(r"^.*?Error:\s*").unwrap().replace(&last_error, "").trim_end_matches('.').to_string();
        return json_status(503, &json!({ "error": format!("The AI provider rejected the API key ({})", detail) }));
    }
    if is_usage_limit(&last_error) {
        let limit = regex::Regex::new(r"(?i)usage limit reached \([^)]*\)").unwrap().find(&last_error).map(|m| format!("AI {}", m.as_str()));
        return json_status(429, &json!({ "error": limit.unwrap_or_else(|| "AI usage limit reached".into()) }));
    }
    json_status(502, &json!({ "error": last_error }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A white page with dark panels in a 2x2 grid separated by white gutters.
    fn grid_page() -> Vec<u8> {
        let (w, h) = (600u32, 800u32);
        let img = image::RgbImage::from_fn(w, h, |x, y| {
            let in_panel = |v: u32, a: u32, b: u32| v >= a && v < b;
            let col = in_panel(x, 30, 285) || in_panel(x, 315, 570);
            let row = in_panel(y, 30, 385) || in_panel(y, 415, 770);
            if col && row { image::Rgb([40, 40, 40]) } else { image::Rgb([255, 255, 255]) }
        });
        let mut out = std::io::Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Jpeg).unwrap();
        out.into_inner()
    }

    #[test]
    fn gutters_find_a_grid_in_reading_order() {
        let panels = detect_by_gutters(&grid_page()).expect("panels");
        assert_eq!(panels.len(), 4);
        let xs: Vec<f64> = panels.iter().map(|p| p["x"].as_f64().unwrap()).collect();
        let ys: Vec<f64> = panels.iter().map(|p| p["y"].as_f64().unwrap()).collect();
        assert!(xs[0] < xs[1] && ys[0] == ys[1], "{:?}", panels);
        assert!(ys[2] > ys[0] && xs[2] < xs[3], "{:?}", panels);
    }

    #[test]
    fn gutters_reject_blank_and_non_jpeg() {
        assert!(detect_by_gutters(b"not a jpeg").is_none());
        let blank = image::RgbImage::from_pixel(400, 400, image::Rgb([255, 255, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        blank.write_to(&mut out, image::ImageFormat::Jpeg).unwrap();
        assert!(detect_by_gutters(&out.into_inner()).is_none());
    }

    #[test]
    fn llm_reply_parsing() {
        let p = parse_panels("```json\n{\"panels\":[{\"x\":0.1,\"y\":0.1,\"w\":2,\"h\":0.5},{\"x\":0,\"y\":0,\"w\":0.01,\"h\":0.5}]}\n```").unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0]["w"].as_f64().unwrap(), 0.9);
        assert!(parse_panels("no json").is_none());
    }

    #[test]
    fn decision_parsing() {
        let answers = json!({
            "exists1": {"noul": 0.9}, "panel1": {"box": {"left": 0.0, "top": 0.0, "right": 0.5, "bottom": 0.5}},
            "exists2": {"noul": 0.9}, "panel2": {"box": {"left": 0.0, "top": 0.0, "right": 0.49, "bottom": 0.5}},
            "exists3": {"noul": 0.8}, "panel3": {"box": {"left": 0.5, "top": 0.5, "right": 1.0, "bottom": 1.0}},
            "exists4": {"noul": 0.1}
        });
        assert_eq!(parse_decisions(&answers).unwrap().len(), 2);
    }

    #[test]
    fn quota_reset_delay() {
        assert_eq!(reset_delay("limit; resets in 2h 5m"), Duration::from_secs(125 * 60));
        assert_eq!(reset_delay("nothing"), Duration::from_secs(600));
    }
}
