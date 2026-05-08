// On-disk pointer file + keychain helpers for Slack credentials.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

use super::{KEYCHAIN_SERVICE, SLACK_CONFIG_REL};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SlackConfig {
    pub workspace_id: String,
    pub workspace_name: String,
    pub bot_user_id: String,
    pub bot_name: String,
    pub connected_at: String,
    /// Reserved for an opt-in tightening — empty in V1 means "allow
    /// all in-workspace humans" (guests + externals + bots are
    /// always blocked regardless).
    #[serde(default)]
    pub allowed_domains: Vec<String>,
}

/// Cross-platform app data directory.
fn app_data_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support"))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .map_err(|_| "APPDATA not set".to_string())
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        Ok(PathBuf::from(home).join(".local").join("share"))
    }
}

/// Build the app-support path for a vault's Slack config.
///
/// Layout: `<app-data>/OpenIT/<hash>/credentials/slack.json`
/// where `<hash>` is the first 16 hex chars of the SHA-256 of the
/// canonical vault path. Creates the `credentials/` directory with
/// 0o700 permissions (Unix) if it doesn't already exist.
///
/// Platform paths:
///   macOS:   ~/Library/Application Support/OpenIT/<hash>/credentials/
///   Linux:   ~/.local/share/OpenIT/<hash>/credentials/
///   Windows: %APPDATA%/OpenIT/<hash>/credentials/
fn app_support_slack_config_path(repo: &Path) -> Result<PathBuf, String> {
    let canonical = repo
        .canonicalize()
        .map_err(|e| format!("canonicalize repo path: {}", e))?;
    let hash_full = Sha256::digest(canonical.to_string_lossy().as_bytes());
    let hash_hex: String = hash_full
        .iter()
        .take(8) // 8 bytes = 16 hex chars
        .map(|b| format!("{:02x}", b))
        .collect();

    let base = app_data_dir()?;
    let cred_dir = base.join("OpenIT").join(&hash_hex).join("credentials");

    if !cred_dir.is_dir() {
        std::fs::create_dir_all(&cred_dir).map_err(|e| format!("create credentials dir: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&cred_dir, std::fs::Permissions::from_mode(0o700))
                .map_err(|e| format!("chmod credentials dir: {}", e))?;
        }
    }

    Ok(cred_dir.join("slack.json"))
}

/// Legacy path — used only for one-time migration.
fn legacy_slack_config_path(repo: &Path) -> PathBuf {
    repo.join(SLACK_CONFIG_REL)
}

pub(super) fn slack_config_path(repo: &Path) -> Result<PathBuf, String> {
    app_support_slack_config_path(repo)
}

pub(super) async fn read_slack_config(repo: &Path) -> Result<Option<SlackConfig>, String> {
    let path = slack_config_path(repo)?;

    // One-time migration: if the app-support file doesn't exist but the
    // legacy in-vault file does, move it across and delete the old one.
    if !path.exists() {
        let legacy = legacy_slack_config_path(repo);
        if legacy.is_file() {
            // Ensure destination directory exists (app_support_slack_config_path
            // already created it, but guard against a race).
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| format!("mkdir credentials (migration): {}", e))?;
            }
            tokio::fs::copy(&legacy, &path)
                .await
                .map_err(|e| format!("migrate slack config: {}", e))?;
            // Best-effort delete of the old file.
            let _ = tokio::fs::remove_file(&legacy).await;
        }
    }

    let raw = match tokio::fs::read_to_string(&path).await {
        Ok(s) => s,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("read slack config: {}", err)),
    };
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|err| format!("parse slack config: {}", err))
}

pub(super) async fn write_slack_config(repo: &Path, cfg: &SlackConfig) -> Result<(), String> {
    let path = slack_config_path(repo)?;
    // Parent directory (credentials/) is created by app_support_slack_config_path,
    // but guard against a race with an explicit create_dir_all.
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("mkdir credentials: {}", e))?;
    }
    let body =
        serde_json::to_string_pretty(cfg).map_err(|e| format!("serialize slack config: {}", e))?;
    tokio::fs::write(&path, body)
        .await
        .map_err(|e| format!("write slack config: {}", e))
}

pub(super) async fn delete_slack_config(repo: &Path) -> Result<(), String> {
    let path = slack_config_path(repo)?;
    match tokio::fs::remove_file(&path).await {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(format!("delete slack config: {}", err)),
    }
    // Also clean up the legacy in-vault file if it still exists.
    let legacy = legacy_slack_config_path(repo);
    match tokio::fs::remove_file(&legacy).await {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(format!("delete legacy slack config: {}", err)),
    }
    Ok(())
}

pub(super) fn keychain_set_blocking(slot: &str, value: &str) -> Result<(), String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, slot)
        .map_err(|e| e.to_string())?
        .set_password(value)
        .map_err(|e| e.to_string())
}

pub(super) fn keychain_get_blocking(slot: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, slot).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

pub(super) fn keychain_delete_blocking(slot: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, slot).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}
