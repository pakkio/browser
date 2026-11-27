//! AI provider access (LM Studio, OpenRouter, OpenCode Go; all OpenAI-compatible) with the
//! fallback-model logic, file summaries and directory suggestions (lib/ai-file-analyzer.js).

use std::path::Path;
use std::time::{Duration, Instant};

use axum::extract::State;
use serde_json::{json, Map, Value};

use crate::app::{json as json_resp, ApiError, ApiResult, AppRef, Ctx};
use crate::jsutil::{self, js_prefix};

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}

fn list_env(k: &str, default: &str) -> Vec<String> {
    std::env::var(k).unwrap_or_else(|_| default.into()).split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}

#[derive(Clone)]
pub struct Analyzer {
    pub provider: String,
    lmstudio_url: String,
    lmstudio_model: String,
    pub openrouter_key: Option<String>,
    pub openrouter_model: String,
    openrouter_fallbacks: Vec<String>,
    pub opencodego_key: Option<String>,
    pub opencodego_model: String,
    pub opencodego_fallbacks: Vec<String>,
    session_id: String,
    http: reqwest::Client,
}

pub struct Config {
    pub provider: &'static str,
    url: String,
    pub model: String,
    headers: Vec<(&'static str, String)>,
}

#[derive(Default, Debug)]
pub struct AiResult {
    pub success: bool,
    pub content: Option<String>,
    pub error: Option<String>,
    pub filtered: bool,
    pub retryable: bool,
    pub stats: Option<Value>,
}

#[derive(Default, Clone)]
pub struct Options {
    pub model: Option<String>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u64>,
    pub json_object: bool,
}

impl Analyzer {
    pub fn new(http: reqwest::Client) -> Self {
        let provider = env("AI_PROVIDER").unwrap_or_else(|| {
            if env("LMSTUDIO_URL").is_some() {
                "lmstudio"
            } else if env("OPENROUTER_API_KEY").is_some() {
                "openrouter"
            } else if env("OPENCODEGO_API_KEY").is_some() {
                "opencodego"
            } else {
                "none"
            }
            .into()
        });
        Analyzer {
            provider,
            lmstudio_url: env("LMSTUDIO_URL").unwrap_or_else(|| "http://10.5.0.2:1234".into()),
            lmstudio_model: env("LMSTUDIO_MODEL").unwrap_or_else(|| "llama-3.1-deephermes-r1-reasoning-8b-darkidol-instruct-1.2-uncensored".into()),
            openrouter_key: env("OPENROUTER_API_KEY").map(|k| k.trim().to_string()),
            openrouter_model: env("OPENROUTER_DEFAULT_MODEL").unwrap_or_else(|| "openai/gpt-4o-mini".into()),
            openrouter_fallbacks: list_env("OPENROUTER_FALLBACK_MODELS", "inclusionai/ling-3.2-flash:free,nvidia/nemotron-3-ultra-550b-a55b:free"),
            opencodego_key: env("OPENCODEGO_API_KEY").map(|k| k.trim().to_string()),
            opencodego_model: env("OPENCODEGO_MODEL").unwrap_or_else(|| "deepseek-v4.1-flash".into()),
            opencodego_fallbacks: list_env("OPENCODEGO_FALLBACK_MODELS", "grok-4.7,kimi-k2.7-code"),
            session_id: format!("file-browser-{}-{}", std::process::id(), jsutil::now_ms()),
            http,
        }
    }

    pub fn config(&self) -> Option<Config> {
        match self.provider.as_str() {
            "lmstudio" => {
                let base = self.lmstudio_url.trim_end_matches('/');
                let origin = reqwest::Url::parse(base).ok().map(|u| {
                    format!("{}://{}:{}", u.scheme(), u.host_str().unwrap_or("localhost"), u.port().unwrap_or(1234))
                })?;
                Some(Config {
                    provider: "lmstudio",
                    url: format!("{}/v1/chat/completions", origin),
                    model: self.lmstudio_model.clone(),
                    headers: vec![],
                })
            }
            "openrouter" => self.openrouter_key.as_ref().map(|k| Config {
                provider: "openrouter",
                url: "https://openrouter.ai/api/v1/chat/completions".into(),
                model: self.openrouter_model.clone(),
                headers: vec![
                    ("authorization", format!("Bearer {}", k)),
                    ("http-referer", env("OPENROUTER_APP_URL").unwrap_or_else(|| "http://localhost:7863".into())),
                    ("x-title", env("OPENROUTER_APP_TITLE").unwrap_or_else(|| "File Browser AI".into())),
                ],
            }),
            "opencodego" => self.opencodego_key.as_ref().map(|k| Config {
                provider: "opencodego",
                url: "https://opencode.ai/zen/go/v1/chat/completions".into(),
                model: self.opencodego_model.clone(),
                headers: vec![("authorization", format!("Bearer {}", k)), ("x-opencode-session", self.session_id.clone())],
            }),
            _ => None,
        }
    }

    /// One request, then the fallback models: OpenCode Go when its content filter refuses,
    /// OpenRouter when the primary model is rate-limited or its upstream failed.
    pub async fn request(&self, messages: &Value, opts: &Options) -> AiResult {
        let mut result = self.send(messages, opts).await;
        if result.filtered && self.provider == "opencodego" {
            for m in &self.opencodego_fallbacks {
                if *m == self.opencodego_model {
                    continue;
                }
                crate::warn!("AI request blocked by content filter, retrying with {}", m);
                result = self.send(messages, &Options { model: Some(m.clone()), ..opts.clone() }).await;
                if !result.filtered {
                    break;
                }
            }
        }
        if result.retryable && self.provider == "openrouter" && opts.model.is_none() {
            for m in &self.openrouter_fallbacks {
                if *m == self.openrouter_model {
                    continue;
                }
                crate::warn!("OpenRouter model failed ({}), retrying with {}", result.error.clone().unwrap_or_default(), m);
                result = self.send(messages, &Options { model: Some(m.clone()), ..opts.clone() }).await;
                if !result.retryable {
                    break;
                }
            }
        }
        result
    }

    async fn send(&self, messages: &Value, opts: &Options) -> AiResult {
        let Some(cfg) = self.config() else {
            let error = if self.provider == "opencodego" && self.opencodego_key.is_none() {
                "OPENCODEGO_API_KEY is not set"
            } else if self.provider == "openrouter" && self.openrouter_key.is_none() {
                "OPENROUTER_API_KEY is not set"
            } else {
                "No AI provider configured"
            };
            return AiResult { error: Some(error.into()), ..Default::default() };
        };
        let model = opts.model.clone().unwrap_or_else(|| cfg.model.clone());
        let mut body = Map::new();
        body.insert("model".into(), json!(model));
        body.insert("messages".into(), messages.clone());
        body.insert("temperature".into(), json!(opts.temperature.filter(|t| *t != 0.0).unwrap_or(0.7)));
        if let Some(m) = opts.max_tokens {
            body.insert("max_tokens".into(), json!(m));
        }
        if opts.json_object && cfg.provider != "lmstudio" {
            body.insert("response_format".into(), json!({ "type": "json_object" }));
        }
        crate::info!("Making AI request to {}: {} model {}", cfg.provider, cfg.url, model);
        let started = Instant::now();
        let mut req = self.http.post(&cfg.url).json(&Value::Object(body)).timeout(Duration::from_secs(300));
        for (k, v) in &cfg.headers {
            req = req.header(*k, v);
        }
        let text = match req.send().await {
            Ok(r) => match r.text().await {
                Ok(t) => t,
                Err(e) => return AiResult { error: Some(e.to_string()), ..Default::default() },
            },
            Err(e) => {
                crate::error!("AI request error: {}", e);
                return AiResult { error: Some(e.to_string()), ..Default::default() };
            }
        };
        crate::info!("AI response received from {} in {:.2}s", cfg.provider, started.elapsed().as_secs_f64());
        let result: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => return AiResult { error: Some(format!("Failed to parse API response: {}", e)), ..Default::default() },
        };
        if let Some(err) = result.get("error").filter(|e| jsutil::truthy(Some(e))) {
            let msg = err.get("message").and_then(Value::as_str).map(String::from).unwrap_or_else(|| err.to_string());
            let code = match err.get("code") {
                Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
                Some(Value::String(s)) => s.parse().unwrap_or(0.0),
                _ => 0.0,
            };
            return AiResult {
                error: Some(format!("{} API Error: {}", cfg.provider, msg)),
                retryable: [429.0, 500.0, 502.0, 503.0, 504.0].contains(&code),
                ..Default::default()
            };
        }
        let Some(choice) = result.get("choices").and_then(|c| c.get(0)) else {
            return AiResult { error: Some("Invalid API response structure".into()), ..Default::default() };
        };
        if choice.get("finish_reason").and_then(Value::as_str) == Some("content_filter") {
            return AiResult {
                filtered: true,
                error: Some(format!("The AI model ({}) refused this request because of its content filter", model)),
                ..Default::default()
            };
        }
        let content = choice.get("message").and_then(|m| m.get("content")).and_then(Value::as_str).filter(|c| !c.trim().is_empty());
        let Some(content) = content else {
            return AiResult { error: Some("AI response contained no content".into()), ..Default::default() };
        };
        AiResult {
            success: true,
            content: Some(content.to_string()),
            stats: Some(json!({
                "model": model,
                "provider": cfg.provider,
                "total_time": started.elapsed().as_secs_f64(),
                "input_tokens": result.pointer("/usage/prompt_tokens").and_then(Value::as_u64).unwrap_or(0),
                "output_tokens": result.pointer("/usage/completion_tokens").and_then(Value::as_u64).unwrap_or(0),
                // USD, when the provider reports it (OpenRouter does)
                "cost": result.pointer("/usage/cost").and_then(Value::as_f64),
                "cached": choice.get("finish_reason").and_then(Value::as_str) == Some("cached"),
            })),
            ..Default::default()
        }
    }
}

fn no_stats() -> Value {
    json!({ "model": "none", "provider": "none", "total_time": 0, "input_tokens": 0, "output_tokens": 0, "cached": false })
}

fn error_stats(cfg: &Config, error: &str) -> Value {
    json!({ "model": cfg.model, "provider": cfg.provider, "total_time": 0, "input_tokens": 0, "output_tokens": 0, "cached": false, "error": error })
}

// ---------------------------------------------------------------------------------------------
// Summaries

/// Text of a PDF with Poppler's pdftotext.
async fn pdf_text(file: &str) -> Result<String, String> {
    let out = crate::util::run("pdftotext", &["-enc", "UTF-8", file, "-"], Duration::from_secs(120))
        .await
        .map_err(|e| format!("Failed to extract PDF text: {}", e))?;
    if !out.success() {
        return Err(format!("Failed to extract PDF text: {}", out.stderr_str().trim()));
    }
    Ok(out.stdout_str())
}

async fn summarize(app: &crate::app::App, file_path: Option<&str>, content: Option<&str>, full_pdf: bool) -> Result<(Value, Value), String> {
    let a = Analyzer::new(app.http.clone());
    let Some(cfg) = a.config() else {
        return Ok((
            json!("AI summary is not available. Please configure AI_PROVIDER and LMSTUDIO_URL (or OPENROUTER_API_KEY) in the .env file to enable AI-powered summaries."),
            no_stats(),
        ));
    };
    let mut final_content = content.map(String::from);
    if let Some(fp) = file_path.filter(|_| full_pdf) {
        if jsutil::ext_lower(fp) == ".pdf" {
            let base = app.base_dir();
            let full = jsutil::resolve(&base, fp);
            let extracted = if full.starts_with(&base) {
                pdf_text(&full).await
            } else {
                Err("Failed to extract PDF text: Path outside allowed directory".into())
            };
            match extracted {
                Ok(t) => final_content = Some(t),
                Err(e) => {
                    let mut stats = no_stats();
                    stats["error"] = json!(e);
                    return Ok((json!(format!("Failed to extract full PDF text: {}", e)), stats));
                }
            }
        }
    }
    let body = match final_content.as_deref().filter(|c| !c.is_empty()) {
        Some(c) => format!("Please summarize the following content:\n\n{}", js_prefix(c, 12000)),
        None => format!(
            "Please summarize the file at path: {}\n\nNote: The content should be extracted from the file first.",
            file_path.unwrap_or("undefined")
        ),
    };
    let prompt = format!(
        "You are an AI assistant that creates concise, useful summaries of documents and files.\n\n{}\n\nINSTRUCTIONS:\n\
- Create a clear, concise summary in 2-4 paragraphs\n- Identify the main topic, key points, and important details\n\
- If it's code, explain what the code does and its purpose\n- If it's a document, summarize the main arguments or information\n\
- If it's data, describe what kind of data and its structure\n- Keep the summary informative but brief\n\
- Use bullet points for key takeaways if helpful\n\nRespond with just the summary text, no additional formatting.",
        body
    );
    let messages = json!([
        { "role": "system", "content": "You are an AI that creates helpful, concise summaries of files and documents. Always provide clear, accurate summaries that capture the essential information." },
        { "role": "user", "content": prompt }
    ]);
    let r = a.request(&messages, &Options { max_tokens: Some(500), temperature: Some(0.3), ..Default::default() }).await;
    if !r.success {
        let e = r.error.unwrap_or_default();
        return Ok((json!(format!("Error during AI summarization: {}", e)), error_stats(&cfg, &e)));
    }
    Ok((json!(r.content), r.stats.unwrap_or(Value::Null)))
}

// POST /api/summarize-file
pub async fn summarize_file(State(app): State<AppRef>, ctx: Ctx) -> ApiResult {
    let fp = ctx.b("path").filter(|v| jsutil::truthy(Some(v))).and_then(Value::as_str).map(String::from);
    let content = ctx.b("content").filter(|v| jsutil::truthy(Some(v))).and_then(Value::as_str).map(String::from);
    if fp.is_none() && content.is_none() {
        return Err(ApiError::bad_request("File path or content is required"));
    }
    let full_pdf = jsutil::truthy(ctx.b("fullPdf"));
    let (summary, stats) = summarize(&app, fp.as_deref(), content.as_deref(), full_pdf).await.map_err(ApiError::internal)?;
    Ok(json_resp(&json!({ "success": true, "summary": summary, "stats": stats })))
}

// ---------------------------------------------------------------------------------------------
// Directory suggestions

fn collect_files(dir: &str) -> Vec<Value> {
    let Ok(entries) = crate::browse::read_dir_js(dir) else { return vec![] };
    let mut out = Vec::new();
    for (name, ft) in entries {
        if name.starts_with('.') || ["node_modules", "__pycache__", "dist", "build"].contains(&name.as_str()) {
            continue;
        }
        let full = Path::new(dir).join(&name).to_string_lossy().into_owned();
        if ft.is_dir() {
            out.push(json!({ "name": name, "type": "directory", "path": name, "fullPath": full }));
        } else {
            let Ok(meta) = std::fs::metadata(&full) else { continue };
            out.push(json!({
                "name": name, "type": "file", "extension": jsutil::ext_lower(&name), "path": name, "fullPath": full,
                "size": meta.len(), "modified": meta.modified().ok().map(jsutil::iso),
            }));
        }
    }
    out
}

const INTERESTING_EXT: &[&str] = &[
    ".pdf", ".txt", ".md", ".doc", ".docx", ".epub", ".py", ".js", ".html", ".json", ".csv", ".xlsx", ".pptx", ".rtf", ".mp3", ".flac", ".wav",
    ".m4a", ".aac", ".ogg", ".wma", ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".jpg", ".jpeg", ".jfif", ".pjpeg", ".pjp", ".png",
    ".gif", ".bmp", ".tiff", ".webp", ".svg", ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".cbz", ".cbr", ".mobi", ".azw", ".azw3",
];
const KEYWORDS: &[&str] = &[
    "readme", "doc", "guide", "manual", "tutorial", "book", "story", "novel", "article", "paper", "research", "report", "analysis", "notes",
    "journal", "diary", "log", "spec", "design", "album", "music", "song", "track", "playlist", "concert", "live", "video", "movie", "film",
    "documentary", "series", "episode", "photo", "picture", "image", "gallery", "collection",
];

/// Names too generic to be worth suggesting (numbers, "track01", very short names).
pub fn is_generic(stem: &str) -> bool {
    let re1 = regex::Regex::new(r"^\d+$").unwrap();
    let re2 = regex::Regex::new(r"^\d{5,}").unwrap();
    let re3 = regex::Regex::new(r"(?i)^(track|song|audio|video|file|untitled|new|copy|document)\d*$").unwrap();
    re1.is_match(stem) || re2.is_match(stem) || re3.is_match(stem) || jsutil::js_len(stem) <= 2
}

pub fn filter_interesting(files: &[Value]) -> Vec<Value> {
    let strip_ext = regex::Regex::new(r"\.[^/.]+$").unwrap();
    files
        .iter()
        .filter(|f| {
            let name = f["name"].as_str().unwrap_or("");
            let lower = name.to_lowercase();
            if f["type"] == "directory" {
                return KEYWORDS.iter().any(|k| lower.contains(k)) || ["docs", "documentation", "books", "papers", "articles"].contains(&lower.as_str());
            }
            if is_generic(&strip_ext.replace(name, "")) {
                return false;
            }
            if INTERESTING_EXT.contains(&f["extension"].as_str().unwrap_or("")) {
                return true;
            }
            KEYWORDS.iter().any(|k| lower.contains(k))
        })
        .cloned()
        .collect()
}

async fn analyze_with_llm(a: &Analyzer, files: &[Value], context: &str) -> (Value, Value) {
    let limited: Vec<&Value> = files.iter().take(100).collect();
    let data: Vec<Value> = limited
        .iter()
        .map(|f| json!({ "name": f["name"], "type": f["type"], "path": f["path"], "extension": f.get("extension").cloned().unwrap_or(json!("")), "size": f.get("size").cloned().unwrap_or(json!(0)) }))
        .collect();
    let prompt = format!(
        r#"You are an AI assistant helping a user discover interesting files to read from their file browser.

User request: {}

Here are the files and directories available in the current directory:
{}

IMPORTANT INSTRUCTIONS:
- Pay close attention to the user's specific request above
- If they ask for specific authors (like "Heinlein"), look carefully at filenames for those author names
- If they ask for "shortest files", consider file sizes
- If they ask for specific genres or topics, prioritize those matches
- Look for patterns in filenames that match the user's request

Based on the file names, extensions, paths, and sizes, suggest the 5-8 most relevant files that match the user's request. Consider:
1. Educational content (PDFs, books, documentation)
2. Fiction and literature (novels, stories, authors)
3. Technical content (guides, manuals, code)
4. Media content (music, videos, images)
5. Research and academic content
6. Personal documents and notes

For each suggestion, provide:
- The file path
- A brief reason why it matches the user's request
- What type of content it likely contains
- An engagement score (1-10) for how well it matches the request

Respond in JSON format:
{{
  "suggestions": [
    {{
      "path": "relative/path/to/file",
      "name": "filename.ext",
      "reason": "Why this matches the user's request",
      "content_type": "Type of content (e.g., 'Science Fiction Novel', 'Technical Guide', 'Music Album')",
      "engagement_score": 8
    }}
  ],
  "summary": "Brief overview of what was found that matches the user's request"
}}"#,
        if context.is_empty() { "General browsing" } else { context },
        serde_json::to_string_pretty(&data).unwrap_or_default()
    );
    let Some(cfg) = a.config() else {
        let fallback = json!({
            "suggestions": [
                { "path": "sample.pdf", "name": "Sample Document.pdf",
                  "reason": "This is a sample suggestion. Configure AI_PROVIDER and LMSTUDIO_URL (or OPENROUTER_API_KEY) in .env to get real AI-powered suggestions.",
                  "content_type": "Sample PDF Document", "engagement_score": 7 },
                { "path": "README.md", "name": "README.md",
                  "reason": "Documentation files often contain important information about the project.",
                  "content_type": "Documentation", "engagement_score": 6 }
            ],
            "summary": "Sample AI analysis. Configure an AI provider to get real suggestions."
        });
        return (fallback, no_stats());
    };
    let messages = json!([
        { "role": "system", "content": "You are an AI analyzing file collections to suggest interesting reading material. You must respond with valid JSON according to the provided schema." },
        { "role": "user", "content": prompt }
    ]);
    let r = a.request(&messages, &Options { temperature: Some(0.7), json_object: true, ..Default::default() }).await;
    if !r.success {
        let e = r.error.unwrap_or_default();
        let analysis = json!({
            "suggestions": [{ "path": "error.txt", "name": "Analysis Error.txt", "reason": format!("Failed to analyze files: {}", e),
                              "content_type": "Error Report", "engagement_score": 5 }],
            "summary": format!("Error during AI analysis: {}", e)
        });
        return (analysis, error_stats(&cfg, &e));
    }
    let content = r.content.unwrap_or_default();
    let analysis = serde_json::from_str::<Value>(&content).unwrap_or_else(|_| {
        json!({
            "suggestions": [{
                "path": limited.first().map(|f| f["path"].clone()).unwrap_or(json!("unknown")),
                "name": limited.first().map(|f| f["name"].clone()).unwrap_or(json!("unknown")),
                "reason": "LLM response was not in valid JSON format", "content_type": "Unknown", "engagement_score": 5
            }],
            "summary": format!("Analysis completed but response format was unexpected. Raw response: {}...", js_prefix(&content, 200))
        })
    });
    (analysis, r.stats.unwrap_or(Value::Null))
}

// POST /api/analyze-files
pub async fn analyze_files(State(app): State<AppRef>, ctx: Ctx) -> ApiResult {
    let dir = match ctx.b("path") {
        None | Some(Value::Null) => return Err(ApiError::bad_request("Directory path is required")),
        Some(Value::String(s)) => s.clone(),
        Some(v) => v.to_string(),
    };
    let full = crate::browse::resolve_safe_path(&app, &dir)?;
    let context = ctx.b_str("context").unwrap_or("").to_string();
    let all = tokio::task::spawn_blocking(move || collect_files(&full)).await.map_err(ApiError::internal)?;
    let interesting = filter_interesting(&all);
    if interesting.is_empty() {
        return Ok(json_resp(&json!({ "success": true, "suggestions": [], "summary": "No particularly interesting files found in this directory.", "stats": null })));
    }
    let a = Analyzer::new(app.http.clone());
    let (analysis, stats) = analyze_with_llm(&a, &interesting, &context).await;
    let mut suggestions = analysis.get("suggestions").and_then(Value::as_array).cloned().unwrap_or_default();
    let score = |v: &Value| v.get("engagement_score").and_then(Value::as_f64).filter(|f| !f.is_nan()).unwrap_or(0.0);
    suggestions.sort_by(|a, b| score(b).total_cmp(&score(a)));
    let summary = analysis.get("summary").filter(|s| jsutil::truthy(Some(s))).cloned().unwrap_or(json!("Analysis completed"));
    Ok(json_resp(&json!({
        "success": true, "suggestions": suggestions, "summary": summary, "stats": stats,
        "totalFiles": all.len(), "filteredFiles": interesting.len(),
    })))
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generic_names() {
        assert!(is_generic("12345"));
        assert!(is_generic("track01"));
        assert!(is_generic("ab"));
        assert!(!is_generic("Dune"));
    }

    #[test]
    fn interesting_filter() {
        let files = vec![
            json!({"name": "Dune.epub", "type": "file", "extension": ".epub"}),
            json!({"name": "track01.mp3", "type": "file", "extension": ".mp3"}),
            json!({"name": "books", "type": "directory"}),
            json!({"name": "tmp", "type": "directory"}),
        ];
        let names: Vec<String> = filter_interesting(&files).iter().map(|f| f["name"].as_str().unwrap().to_string()).collect();
        assert_eq!(names, vec!["Dune.epub", "books"]);
    }
}
