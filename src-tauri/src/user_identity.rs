use std::process::Command;

/// Read the user's global git `user.email` if set. Used by in-app
/// flows that need an "admin identity" to stamp on a write (e.g. the
/// conversation-thread reply composer). Returns None if the value is
/// missing, blank, or matches the project-local placeholder
/// `openit@local` — callers fall through to a generic identity.
#[tauri::command]
pub fn global_user_email() -> Result<Option<String>, String> {
    let output = Command::new("git")
        .args(["config", "--global", "user.email"])
        .output()
        .map_err(|e| format!("failed to run git: {}", e))?;
    if !output.status.success() {
        return Ok(None);
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() || raw == "openit@local" {
        return Ok(None);
    }
    Ok(Some(raw))
}
