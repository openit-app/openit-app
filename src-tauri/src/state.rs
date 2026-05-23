use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct AppState {
    pub last_repo: Option<String>,
    pub pane_sizes: Option<Vec<f64>>,
    pub pinned_bubbles: Option<Vec<String>>,
    pub onboarding_complete: bool,
    /// Whether the left sidebar is collapsed to an icon-only rail.
    /// `None` = first launch (default expanded). Once the user toggles,
    /// the choice is persisted as `Some(true|false)` so it survives
    /// app restarts. Per-user via app data dir (NOT per-vault).
    pub sidebar_collapsed: Option<bool>,
}

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app_data_dir: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("state.json"))
}

#[tauri::command]
pub fn state_load<R: Runtime>(app: AppHandle<R>) -> Result<AppState, String> {
    let path = state_path(&app)?;
    if !path.exists() {
        return Ok(AppState::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn state_save<R: Runtime>(app: AppHandle<R>, state: AppState) -> Result<(), String> {
    let path = state_path(&app)?;
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_state_without_sidebar_flag_deserializes_as_none() {
        // Forward-compat: state.json files written by older builds
        // (pre-PIN-6613) don't carry the `sidebar_collapsed` field.
        // `#[serde(default)]` on the struct must let those load
        // cleanly, otherwise everyone's persisted state would be
        // wiped on first launch after the upgrade.
        let raw = r#"{
            "last_repo": "/Users/me/OpenIT/Personal",
            "pane_sizes": [24.0, 40.0, 36.0],
            "pinned_bubbles": [],
            "onboarding_complete": true
        }"#;
        let state: AppState = serde_json::from_str(raw).expect("legacy parse");
        assert_eq!(state.sidebar_collapsed, None);
        assert!(state.onboarding_complete);
    }

    #[test]
    fn sidebar_flag_round_trips() {
        let original = AppState {
            sidebar_collapsed: Some(true),
            onboarding_complete: true,
            ..AppState::default()
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let parsed: AppState = serde_json::from_str(&json).expect("parse");
        assert_eq!(parsed.sidebar_collapsed, Some(true));
        assert!(parsed.onboarding_complete);
    }

    #[test]
    fn first_launch_defaults_to_none() {
        // Fresh install (no state.json) → AppState::default() → None.
        // Frontend reads None as "first launch, default to expanded".
        let state = AppState::default();
        assert_eq!(state.sidebar_collapsed, None);
    }
}
