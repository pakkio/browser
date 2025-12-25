---
applyTo: '**'
---

# Opencode User Preferences

- Preferred GitHub integration method: `gh` CLI
- All agentic workflows should use `gh` for PR, issue, and review automation.
- When automating GitHub tasks, always prefer `gh` over direct API calls or other tools.

## Session Packing/Unpacking Instructions

### Packing (Saving) a Session
1. Save the conversation history as a JSON file (e.g., session.json).
2. Compress the JSON file using gzip.
   Example: `gzip -c session.json > session.json.gz`
3. Encode the compressed file in base64.
   Example: `base64 session.json.gz > session.json.b64`
4. (Optional) Store the base64 string directly as session.json for easy restoration.

### Unpacking (Restoring) a Session
1. Concatenate all lines of the base64-encoded session file (if split across lines).
2. Decode the base64 content.
   Example: `base64 -d session.json > session.json.gz`
3. Decompress the gzip file to retrieve the original JSON.
   Example: `gunzip -c session.json.gz > session.json`
4. Use the resulting JSON to restore the session state.

(Last updated: 2025-08-12)
