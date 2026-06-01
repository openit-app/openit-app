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

/// Read the user's global git `user.name` if set. Used by the tasks
/// composer to default the assignee field to the current user — the
/// caller falls back to a generic "me" when this returns None. We
/// also strip the project-local placeholder `OpenIT` (set by
/// `git_ensure_repo`) so a vault-local commit identity doesn't leak
/// in as the assignee default.
#[tauri::command]
pub fn global_user_name() -> Result<Option<String>, String> {
    let output = Command::new("git")
        .args(["config", "--global", "user.name"])
        .output()
        .map_err(|e| format!("failed to run git: {}", e))?;
    if !output.status.success() {
        return Ok(None);
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() || raw == "OpenIT" {
        return Ok(None);
    }
    Ok(Some(raw))
}

/// Read the OS account's full ("real") name. macOS/BSD `id -F` prints it
/// (e.g. "Ada Lovelace"); it's set at account creation for essentially
/// every user, so it's a far better default than git config — which most
/// non-developers never set. Used only as an *editable suggestion* in the
/// first-run profile prompt: we ask, we don't silently adopt it. Returns
/// None when unavailable (non-macOS, or no full name configured); callers
/// fall back to git name, then to an empty prompt.
#[tauri::command]
pub fn os_full_name() -> Result<Option<String>, String> {
    let output = match Command::new("id").arg("-F").output() {
        Ok(o) => o,
        // `id -F` is macOS/BSD-only — GNU `id` rejects -F. Treat any spawn
        // or flag failure as "no suggestion" rather than an error.
        Err(_) => return Ok(None),
    };
    if !output.status.success() {
        return Ok(None);
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return Ok(None);
    }
    Ok(Some(raw))
}
