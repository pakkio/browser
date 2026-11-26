//! Encrypted store for service logins (mega.nz), file-compatible with lib/credentials.js:
//! .credentials.json holds {service: {username, secret}} where secret is
//! base64(iv).base64(tag).base64(ciphertext), AES-256-GCM. The key is sha256(CREDENTIALS_KEY)
//! or a random key kept in hex in .credentials.key.

use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::RngCore;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

fn data_dir(app_dir: &Path) -> PathBuf {
    std::env::var_os("CREDENTIALS_DIR").map(PathBuf::from).unwrap_or_else(|| app_dir.to_path_buf())
}

fn write_private(path: &Path, data: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
        f.write_all(data)
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, data)
    }
}

fn key(app_dir: &Path) -> std::io::Result<[u8; 32]> {
    if let Ok(k) = std::env::var("CREDENTIALS_KEY") {
        if !k.is_empty() {
            return Ok(Sha256::digest(k.as_bytes()).into());
        }
    }
    let file = data_dir(app_dir).join(".credentials.key");
    match std::fs::read_to_string(&file) {
        Ok(text) => {
            let bytes = hex::decode(text.trim()).unwrap_or_default();
            let mut k = [0u8; 32];
            let n = bytes.len().min(32);
            k[..n].copy_from_slice(&bytes[..n]);
            Ok(k)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let mut k = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut k);
            write_private(&file, hex::encode(k).as_bytes())?;
            Ok(k)
        }
        Err(e) => Err(e),
    }
}

fn encrypt(app_dir: &Path, plain: &str) -> std::io::Result<String> {
    let k = key(app_dir)?;
    let cipher = Aes256Gcm::new_from_slice(&k).expect("32-byte key");
    let mut iv = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut iv);
    let sealed = cipher
        .encrypt(Nonce::from_slice(&iv), plain.as_bytes())
        .map_err(|_| std::io::Error::other("encryption failed"))?;
    let (data, tag) = sealed.split_at(sealed.len() - 16);
    Ok(format!("{}.{}.{}", B64.encode(iv), B64.encode(tag), B64.encode(data)))
}

fn decrypt(app_dir: &Path, token: &str) -> Option<String> {
    let parts: Vec<Vec<u8>> = token.split('.').map(|p| B64.decode(p).ok()).collect::<Option<_>>()?;
    let [iv, tag, data] = <[Vec<u8>; 3]>::try_from(parts).ok()?;
    if iv.len() != 12 {
        return None;
    }
    let k = key(app_dir).ok()?;
    let cipher = Aes256Gcm::new_from_slice(&k).ok()?;
    let mut sealed = data;
    sealed.extend_from_slice(&tag);
    let plain = cipher.decrypt(Nonce::from_slice(&iv), sealed.as_slice()).ok()?;
    String::from_utf8(plain).ok()
}

fn store_file(app_dir: &Path) -> PathBuf {
    data_dir(app_dir).join(".credentials.json")
}

fn read_store(app_dir: &Path) -> std::io::Result<Map<String, Value>> {
    match std::fs::read_to_string(store_file(app_dir)) {
        Ok(t) => Ok(serde_json::from_str::<Value>(&t)
            .map_err(std::io::Error::other)?
            .as_object()
            .cloned()
            .unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(e),
    }
}

fn write_store(app_dir: &Path, store: &Map<String, Value>) -> std::io::Result<()> {
    write_private(&store_file(app_dir), serde_json::to_string(store).unwrap_or_default().as_bytes())
}

pub fn save(app_dir: &Path, service: &str, username: &str, secret: &str) -> std::io::Result<()> {
    let mut store = read_store(app_dir)?;
    store.insert(service.into(), json!({ "username": username, "secret": encrypt(app_dir, secret)? }));
    write_store(app_dir, &store)
}

/// The full login, server-side only; None when missing or unreadable (key changed, tampered).
pub fn get(app_dir: &Path, service: &str) -> Option<(String, String)> {
    let store = read_store(app_dir).ok()?;
    let entry = store.get(service)?;
    let secret = decrypt(app_dir, entry.get("secret")?.as_str()?)?;
    Some((entry.get("username")?.as_str()?.to_string(), secret))
}

/// Public view: whether a login is saved and for whom, never the secret.
pub fn describe(app_dir: &Path, service: &str) -> std::io::Result<Value> {
    let store = read_store(app_dir)?;
    Ok(match store.get(service) {
        Some(e) => json!({ "saved": true, "username": e.get("username").cloned().unwrap_or(Value::Null) }),
        None => json!({ "saved": false, "username": null }),
    })
}

pub fn remove(app_dir: &Path, service: &str) -> std::io::Result<()> {
    let mut store = read_store(app_dir)?;
    store.remove(service);
    write_store(app_dir, &store)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_tamper() {
        let dir = std::env::temp_dir().join(format!("fbcred-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        save(&dir, "mega", "me@example.com", "s3cret").unwrap();
        assert_eq!(get(&dir, "mega"), Some(("me@example.com".into(), "s3cret".into())));
        assert_eq!(describe(&dir, "mega").unwrap(), json!({"saved": true, "username": "me@example.com"}));
        let raw = std::fs::read_to_string(dir.join(".credentials.json")).unwrap();
        assert!(!raw.contains("s3cret"));
        std::fs::write(dir.join(".credentials.key"), hex::encode([7u8; 32])).unwrap();
        assert_eq!(get(&dir, "mega"), None);
        remove(&dir, "mega").unwrap();
        assert_eq!(describe(&dir, "mega").unwrap()["saved"], json!(false));
        let _ = std::fs::remove_dir_all(dir);
    }
}
