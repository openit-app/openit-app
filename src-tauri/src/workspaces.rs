//! Workspace registry — tracks which vaults the user has opened.
//!
//! Lives at `~/Library/Application Support/OpenIT/workspaces.json`.
//! Each entry is a (path, name, lastOpenedAt) triple. The `active`
//! field records which workspace was most recently open so the app
//! can resume on relaunch.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkspaceEntry {
    pub path: String,
    pub name: String,
    #[serde(rename = "lastOpenedAt")]
    pub last_opened_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct WorkspaceRegistry {
    pub workspaces: Vec<WorkspaceEntry>,
    pub active: Option<String>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn registry_path() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        let dir = PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("OpenIT");
        fs::create_dir_all(&dir).map_err(|e| format!("create app-support dir: {}", e))?;
        Ok(dir.join("workspaces.json"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Linux / Windows — use a platform-appropriate data dir.
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .map_err(|_| "HOME/USERPROFILE not set".to_string())?;
        let dir = PathBuf::from(home).join(".openit");
        fs::create_dir_all(&dir).map_err(|e| format!("create config dir: {}", e))?;
        Ok(dir.join("workspaces.json"))
    }
}

fn read_registry() -> Result<WorkspaceRegistry, String> {
    let path = registry_path()?;
    if !path.exists() {
        return Ok(WorkspaceRegistry::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read registry: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("parse registry: {}", e))
}

fn write_registry(reg: &WorkspaceRegistry) -> Result<(), String> {
    let path = registry_path()?;
    let json =
        serde_json::to_string_pretty(reg).map_err(|e| format!("serialize registry: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("write registry: {}", e))
}

#[tauri::command]
pub fn list_workspaces() -> Result<WorkspaceRegistry, String> {
    read_registry()
}

/// Add a workspace to the registry and set it as active. If a workspace
/// with the same path already exists, update its name and lastOpenedAt.
#[tauri::command]
pub fn create_workspace(path: String, name: String) -> Result<WorkspaceRegistry, String> {
    if path.is_empty() {
        return Err("path cannot be empty".into());
    }
    let mut reg = read_registry()?;
    let now = now_ms();

    if let Some(existing) = reg.workspaces.iter_mut().find(|w| w.path == path) {
        existing.name = name;
        existing.last_opened_at = now;
    } else {
        reg.workspaces.push(WorkspaceEntry {
            path: path.clone(),
            name,
            last_opened_at: now,
        });
    }
    reg.active = Some(path);
    write_registry(&reg)?;
    Ok(reg)
}

/// Set a workspace as active (must already be in the registry).
#[tauri::command]
pub fn set_active_workspace(path: String) -> Result<WorkspaceRegistry, String> {
    let mut reg = read_registry()?;
    let entry = reg
        .workspaces
        .iter_mut()
        .find(|w| w.path == path)
        .ok_or_else(|| format!("workspace not found: {}", path))?;
    entry.last_opened_at = now_ms();
    reg.active = Some(path);
    write_registry(&reg)?;
    Ok(reg)
}

/// Remove a workspace from the registry. If it was active, active becomes None.
#[tauri::command]
pub fn remove_workspace(path: String) -> Result<WorkspaceRegistry, String> {
    let mut reg = read_registry()?;
    reg.workspaces.retain(|w| w.path != path);
    if reg.active.as_deref() == Some(path.as_str()) {
        reg.active = reg.workspaces.first().map(|w| w.path.clone());
    }
    write_registry(&reg)?;
    Ok(reg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    // Guard against parallel test execution — set_var("HOME") is process-global.
    static HOME_MUTEX: Mutex<()> = Mutex::new(());

    fn with_temp_home<F: FnOnce()>(f: F) {
        let _lock = HOME_MUTEX.lock().unwrap();
        let dir = tempfile::TempDir::new().expect("tempdir");
        let path = dir.path().to_path_buf();
        #[cfg(target_os = "macos")]
        std::fs::create_dir_all(path.join("Library").join("Application Support"))
            .expect("pre-create app support");
        std::env::set_var("HOME", &path);
        f();
    }

    #[test]
    fn empty_registry_on_fresh_install() {
        with_temp_home(|| {
            let reg = read_registry().unwrap();
            assert!(reg.workspaces.is_empty());
            assert_eq!(reg.active, None);
        });
    }

    #[test]
    fn create_and_list_workspace() {
        with_temp_home(|| {
            let reg = create_workspace("/tmp/vault1".into(), "Vault 1".into()).unwrap();
            assert_eq!(reg.workspaces.len(), 1);
            assert_eq!(reg.workspaces[0].path, "/tmp/vault1");
            assert_eq!(reg.workspaces[0].name, "Vault 1");
            assert_eq!(reg.active, Some("/tmp/vault1".into()));
        });
    }

    #[test]
    fn duplicate_path_updates_name() {
        with_temp_home(|| {
            create_workspace("/tmp/vault1".into(), "Old".into()).unwrap();
            let reg = create_workspace("/tmp/vault1".into(), "New".into()).unwrap();
            assert_eq!(reg.workspaces.len(), 1);
            assert_eq!(reg.workspaces[0].name, "New");
        });
    }

    #[test]
    fn remove_active_falls_back() {
        with_temp_home(|| {
            create_workspace("/tmp/a".into(), "A".into()).unwrap();
            create_workspace("/tmp/b".into(), "B".into()).unwrap();
            let reg = remove_workspace("/tmp/b".into()).unwrap();
            assert_eq!(reg.active, Some("/tmp/a".into()));
        });
    }
}
