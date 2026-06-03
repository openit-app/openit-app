mod cloud;
mod local;
mod types;

use std::fs;
use std::path::Path;

use local::{
    ensure_dir, fs_dir, fs_path_with_optional_subdir, is_kb_supported, kb_dir, safe_kb_path,
    validate_filename, validate_state_name, validate_subdir,
};
pub use types::{KbLocalFile, KbRemoteFile, KbUploadResult};

// Pre-Phase-2 the manifest schema lived here as `KbState` /
// `KbFileState` and the `entity_state_*` commands deserialized into it.
// Phase 2 introduced a per-collection nested shape in TS
// (`{ <collectionId>: { ... } }`) that doesn't fit the flat struct, so
// the commands now pass through `serde_json::Value`. The TS type
// `KbStatePersisted` in `src/lib/api.ts` is the source of truth.

// ---------------------------------------------------------------------------
// KB commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn kb_init(repo: String) -> Result<String, String> {
    let dir = kb_dir(&repo);
    ensure_dir(&dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn kb_read_file(repo: String, filename: String) -> Result<String, String> {
    let path = safe_kb_path(&repo, &filename)?;
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn kb_write_file(repo: String, filename: String, content: String) -> Result<(), String> {
    if !is_kb_supported(&filename) {
        let ext = Path::new(&filename)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        return Err(format!(
            "Unsupported file type '.{}'. Knowledge base supports: pdf, txt, md, json, csv, docx, xlsx, pptx, jpg, jpeg, png, gif, webp",
            ext
        ));
    }
    let path = safe_kb_path(&repo, &filename)?;
    ensure_dir(&kb_dir(&repo))?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// Write raw bytes to `<repo>/knowledge/<filename>`. Used by the
/// drag-from-desktop handler so binary files (PDFs, images) round-trip
/// correctly.
#[tauri::command]
pub fn kb_write_file_bytes(repo: String, filename: String, bytes: Vec<u8>) -> Result<(), String> {
    if !is_kb_supported(&filename) {
        let ext = Path::new(&filename)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        return Err(format!(
            "Unsupported file type '.{}'. Knowledge base supports: pdf, txt, md, json, csv, docx, xlsx, pptx, jpg, jpeg, png, gif, webp",
            ext
        ));
    }
    let path = safe_kb_path(&repo, &filename)?;
    ensure_dir(&kb_dir(&repo))?;
    fs::write(&path, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn kb_delete_file(repo: String, filename: String) -> Result<(), String> {
    let path = safe_kb_path(&repo, &filename)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// List of supported KB file extensions, for surfacing to the frontend.
#[tauri::command]
pub fn kb_supported_extensions() -> Vec<String> {
    vec![
        "pdf", "txt", "md", "markdown", "json", "csv", "docx", "xlsx", "pptx", "jpg", "jpeg",
        "png", "gif", "webp",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

/// List files in a KB collection via the skills REST endpoint.
/// `format=full` returns signedUrl per file — required for our pull path.
#[tauri::command]
pub async fn kb_list_remote(
    collection_id: String,
    skills_base_url: String,
    access_token: String,
) -> Result<Vec<KbRemoteFile>, String> {
    cloud::list_remote(&collection_id, &skills_base_url, &access_token).await
}

/// Multipart upload of a file from `<repo>/knowledge/<filename>`
/// to the skills file storage endpoint.
#[tauri::command]
pub async fn kb_upload_file(
    repo: String,
    filename: String,
    collection_id: String,
    skills_base_url: String,
    access_token: String,
    subdir: Option<String>,
) -> Result<KbUploadResult, String> {
    cloud::upload_kb_file(
        &repo,
        &filename,
        &collection_id,
        &skills_base_url,
        &access_token,
        subdir.as_deref(),
    )
    .await
}

/// Fetch a download URL and save the body into `<repo>/knowledge/<filename>`.
#[tauri::command]
pub async fn kb_download_to_local(
    repo: String,
    filename: String,
    url: String,
    subdir: Option<String>,
) -> Result<(), String> {
    cloud::download_kb_to_local(&repo, &filename, &url, subdir.as_deref()).await
}

// ---------------------------------------------------------------------------
// Filestore commands — mirror the kb_* local commands but target
// `filestores/library/` and `.openit/fs-state.json`.
//
// Layout split (2026-04-27):
//   filestores/attachments/<id>/<filename>  — operational
//     uploads grouped by an opaque id. Each thread owns its subfolder.
//   filestores/library/<filename>  — curated docs/scripts the admin
//     keeps handy. Synced via the existing `openit-*` cloud filestore
//     collection. Default path that `fs_store_*` commands here target.
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn fs_store_init(repo: String) -> Result<String, String> {
    let dir = fs_dir(&repo);
    ensure_dir(&dir)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn fs_store_read_file(repo: String, filename: String) -> Result<String, String> {
    let path = fs_dir(&repo).join(&filename);
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_store_write_file(repo: String, filename: String, content: String) -> Result<(), String> {
    let dir = fs_dir(&repo);
    ensure_dir(&dir)?;
    let path = dir.join(&filename);
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_store_write_file_bytes(
    repo: String,
    filename: String,
    bytes: Vec<u8>,
    subdir: Option<String>,
) -> Result<(), String> {
    let path = fs_path_with_optional_subdir(&repo, &filename, subdir.as_deref())?;
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    fs::write(&path, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_store_download_to_local(
    repo: String,
    filename: String,
    url: String,
    subdir: Option<String>,
) -> Result<(), String> {
    cloud::download_fs_to_local(&repo, &filename, &url, subdir.as_deref()).await
}

#[tauri::command]
pub async fn fs_store_upload_file(
    repo: String,
    filename: String,
    collection_id: String,
    skills_base_url: String,
    access_token: String,
    subdir: Option<String>,
) -> Result<KbUploadResult, String> {
    cloud::upload_fs_file(
        &repo,
        &filename,
        &collection_id,
        &skills_base_url,
        &access_token,
        subdir.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn fs_store_upload_via_signed_url(
    repo: String,
    filename: String,
    collection_id: String,
    skills_base_url: String,
    access_token: String,
    subdir: Option<String>,
) -> Result<KbUploadResult, String> {
    cloud::upload_fs_via_signed_url(
        &repo,
        &filename,
        &collection_id,
        &skills_base_url,
        &access_token,
        subdir.as_deref(),
    )
    .await
}

// ---------------------------------------------------------------------------
// Generic entity file commands
// ---------------------------------------------------------------------------

/// Load `.openit/<name>-state.json` (the per-entity manifest). Returns
/// raw JSON so the TS layer can interpret both legacy flat and Phase-2
/// nested formats without a Rust-side struct dictating the shape.
///
/// Pre-PIN-5775-Phase-2 this deserialized into the flat `KbState` struct,
/// which silently dropped top-level keys outside `{ collection_id,
/// collection_name, files }`. After Phase 2 introduced the nested
/// `{ <collectionId>: { ... } }` shape, every nested-format save was
/// silently round-tripping back through `KbState`, producing the empty
/// `{ collection_id: null, collection_name: null, files: {} }` we kept
/// observing on disk. Pass-through fixes that.
#[tauri::command]
pub fn entity_state_load(repo: String, name: String) -> Result<serde_json::Value, String> {
    validate_state_name(&name)?;
    let path = Path::new(&repo)
        .join(".openit")
        .join(format!("{}-state.json", name));
    if !path.exists() {
        return Ok(serde_json::Value::Object(serde_json::Map::new()));
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

/// Save `.openit/<name>-state.json`. Pass-through — TS owns the shape.
/// See `entity_state_load` for the rationale.
#[tauri::command]
pub fn entity_state_save(
    repo: String,
    name: String,
    state: serde_json::Value,
) -> Result<(), String> {
    validate_state_name(&name)?;
    let path = Path::new(&repo)
        .join(".openit")
        .join(format!("{}-state.json", name));
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

/// List flat regular-file entries under `<repo>/<subdir>` as `KbLocalFile`
/// records (filename + mtime_ms + size). Skips dotfiles.
#[tauri::command]
pub fn entity_list_local(repo: String, subdir: String) -> Result<Vec<KbLocalFile>, String> {
    local::list_local_files(&repo, &subdir)
}

/// Write a string (typically JSON) to `<repo>/<subdir>/<filename>`.
/// Creates the subdirectory if it doesn't exist. An empty `subdir`
/// targets the repo root — used by plugin sync for files like
/// `CLAUDE.md` that live alongside the top-level vault folders.
#[tauri::command]
pub fn entity_write_file(
    repo: String,
    subdir: String,
    filename: String,
    content: String,
) -> Result<(), String> {
    validate_filename(&filename)?;
    let dir = if subdir.is_empty() {
        Path::new(&repo).to_path_buf()
    } else {
        validate_subdir(&subdir)?;
        let d = Path::new(&repo).join(&subdir);
        ensure_dir(&d)?;
        d
    };
    let path = dir.join(&filename);
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// Generic byte-write to `<repo>/<subdir>/<filename>`. Used for
/// admin-reply attachments (PDF/image/etc. into
/// `filestores/attachments/<ticketId>/<filename>`) and any other
/// case the string-based `entity_write_file` would corrupt.
#[tauri::command]
pub fn entity_write_file_bytes(
    repo: String,
    subdir: String,
    filename: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    validate_subdir(&subdir)?;
    validate_filename(&filename)?;
    let dir = Path::new(&repo).join(&subdir);
    ensure_dir(&dir)?;
    let path = dir.join(&filename);
    fs::write(&path, &bytes).map_err(|e| e.to_string())
}

/// Delete `<repo>/<subdir>/<filename>` if it exists. No-op when missing.
/// Used by sync engine adapters when a server-side delete needs to
/// propagate to local. Path is sandboxed to the repo via `safe_kb_path`-
/// style canonicalization on the parent dir.
#[tauri::command]
pub fn entity_delete_file(repo: String, subdir: String, filename: String) -> Result<(), String> {
    validate_subdir(&subdir)?;
    validate_filename(&filename)?;
    let dir = Path::new(&repo).join(&subdir);
    let path = dir.join(&filename);
    // Only act if the resolved path stays inside the repo. Cheap check —
    // canonicalize the parent (must exist if there's a file in it) and
    // verify it descends from `repo`.
    let repo_canon = fs::canonicalize(&repo).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        if let Ok(parent_canon) = fs::canonicalize(parent) {
            if !parent_canon.starts_with(&repo_canon) {
                return Err(format!(
                    "refusing to delete path outside repo: {}/{}",
                    subdir, filename
                ));
            }
        } else {
            // Parent doesn't exist → nothing to delete.
            return Ok(());
        }
    }
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Rename a file within a subdir. Used by filestore push to reconcile
/// when the server sanitizes a filename (e.g. spaces → dashes) so the
/// local working tree matches what comes back on the next pull and we
/// don't end up with both the original and the sanitized version.
#[tauri::command]
pub fn entity_rename_file(
    repo: String,
    subdir: String,
    from: String,
    to: String,
) -> Result<(), String> {
    if from == to {
        return Ok(());
    }
    validate_subdir(&subdir)?;
    validate_filename(&from)?;
    validate_filename(&to)?;
    let dir = Path::new(&repo).join(&subdir);
    let from_path = dir.join(&from);
    let to_path = dir.join(&to);
    if !from_path.exists() {
        return Ok(());
    }
    // Refuse to overwrite an existing destination. `fs::rename` on
    // Unix/macOS atomically replaces the target without error, which
    // is silent data loss if two source files would land on the same
    // destination name (e.g. distinct local files that sanitize to the
    // same server-canonical filename during PIN-5847 rename-after-push).
    // Make the caller handle the collision explicitly.
    if to_path.exists() {
        return Err(format!("rename target already exists: {}/{}", subdir, to));
    }
    let repo_canon = fs::canonicalize(&repo).map_err(|e| e.to_string())?;
    if let Ok(parent_canon) = fs::canonicalize(&dir) {
        if !parent_canon.starts_with(&repo_canon) {
            return Err(format!("refusing to rename outside repo: {}", subdir));
        }
    }
    fs::rename(&from_path, &to_path).map_err(|e| e.to_string())
}

/// Remove all files in `<repo>/<subdir>` then recreate it empty.
/// Used to do a clean sync of entity directories.
#[tauri::command]
pub fn entity_clear_dir(repo: String, subdir: String) -> Result<(), String> {
    // Most destructive entity_* command: a missing guard here lets a
    // crafted subdir like ".." trigger remove_dir_all on the parent.
    validate_subdir(&subdir)?;
    let dir = Path::new(&repo).join(&subdir);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    ensure_dir(&dir)?;
    Ok(())
}

/// Permanently remove `<repo>/<subdir>` and everything inside it.
/// Unlike `entity_clear_dir` this does NOT recreate the directory —
/// used when the user explicitly deletes a collection from the UI.
#[tauri::command]
pub fn entity_remove_dir(repo: String, subdir: String) -> Result<(), String> {
    validate_subdir(&subdir)?;
    let dir = Path::new(&repo).join(&subdir);
    let repo_canon = fs::canonicalize(&repo).map_err(|e| e.to_string())?;
    if let Ok(dir_canon) = fs::canonicalize(&dir) {
        if !dir_canon.starts_with(&repo_canon) {
            return Err(format!("refusing to remove outside repo: {}", subdir));
        }
    }
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
