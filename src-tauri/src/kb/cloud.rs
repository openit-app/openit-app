use std::fs;

use super::local::{
    ensure_dir, fs_path_with_optional_subdir, kb_path_with_optional_subdir, mime_for, urlencode,
};
use super::types::{KbRemoteFile, KbUploadResult};

/// List files in a KB collection via the skills REST endpoint.
/// `format=full` returns signedUrl per file — required for our pull path.
pub(crate) async fn list_remote(
    collection_id: &str,
    skills_base_url: &str,
    access_token: &str,
) -> Result<Vec<KbRemoteFile>, String> {
    let url = format!(
        "{}/filestorage/items?collectionId={}&format=full",
        skills_base_url.trim_end_matches('/'),
        urlencode(collection_id),
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .header("Auth-Token", format!("Bearer {}", access_token))
        .header("Accept", "*/*")
        .send()
        .await
        .map_err(|e| format!("network error: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, text));
    }

    let parsed: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("could not parse list response: {} — body: {}", e, text))?;
    // The endpoint may return either a bare array or { items: [...] }.
    let items = parsed
        .as_array()
        .cloned()
        .or_else(|| parsed.get("items").and_then(|v| v.as_array()).cloned())
        .unwrap_or_default();

    Ok(items
        .into_iter()
        .map(|it| KbRemoteFile {
            id: it
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            filename: it
                .get("filename")
                .and_then(|v| v.as_str())
                .or_else(|| {
                    it.get("metadata")
                        .and_then(|m| m.get("filename"))
                        .and_then(|v| v.as_str())
                })
                .unwrap_or("")
                .to_string(),
            signed_url: it
                .get("signedUrl")
                .or_else(|| it.get("file_url"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            file_size: it.get("file_size").and_then(|v| v.as_u64()),
            mime_type: it
                .get("mime_type")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            updated_at: it
                .get("updatedAt")
                .or_else(|| it.get("createdAt"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
        .collect())
}

/// Multipart upload of a file from `<repo>/knowledge-bases/<filename>`
/// to the skills file storage endpoint. Returns the parsed response
/// (id, filename, etc.) on success. Works for any file type, including
/// binary — we stream the file bytes directly rather than going through
/// the MCP `upload_file` tool's string `fileContent` param.
/// The `subdir` parameter is accepted for API compat but ignored.
pub(crate) async fn upload_kb_file(
    repo: &str,
    filename: &str,
    collection_id: &str,
    skills_base_url: &str,
    access_token: &str,
    subdir: Option<&str>,
) -> Result<KbUploadResult, String> {
    let path = kb_path_with_optional_subdir(repo, filename, subdir)?;
    if !path.exists() {
        return Err(format!("file not found: {}", path.display()));
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    multipart_upload(
        filename,
        collection_id,
        skills_base_url,
        access_token,
        bytes,
    )
    .await
}

/// Fetch a download URL and save the body into `<repo>/knowledge-bases/<filename>`.
/// Used by the puller to materialise remote KB files locally.
/// The `subdir` parameter is accepted for API compat but ignored.
pub(crate) async fn download_kb_to_local(
    repo: &str,
    filename: &str,
    url: &str,
    subdir: Option<&str>,
) -> Result<(), String> {
    let bytes = download_bytes(url).await?;
    let path = kb_path_with_optional_subdir(repo, filename, subdir)?;
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(())
}

/// Fetch a download URL and save the body into the filestore.
pub(crate) async fn download_fs_to_local(
    repo: &str,
    filename: &str,
    url: &str,
    subdir: Option<&str>,
) -> Result<(), String> {
    let bytes = download_bytes(url).await?;
    let path = fs_path_with_optional_subdir(repo, filename, subdir)?;
    // Ensure parent directory exists (including subdirectories)
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(())
}

/// Multipart upload of a filestore file.
pub(crate) async fn upload_fs_file(
    repo: &str,
    filename: &str,
    collection_id: &str,
    skills_base_url: &str,
    access_token: &str,
    subdir: Option<&str>,
) -> Result<KbUploadResult, String> {
    let path = fs_path_with_optional_subdir(repo, filename, subdir)?;
    if !path.exists() {
        return Err(format!("file not found: {}", path.display()));
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    multipart_upload(
        filename,
        collection_id,
        skills_base_url,
        access_token,
        bytes,
    )
    .await
}

/// Two-step upload via the signed-URL endpoint (PIN-5847). Replaces the
/// multipart `fs_store_upload_file` path for filestore sync pushes. The
/// multipart `/upload` endpoint adds a UUID prefix on every call and
/// creates a fresh Firestore doc each time, so re-pushing the same
/// file accumulates duplicates server- and client-side. The
/// `/upload-request` endpoint:
///   1. POST JSON `{ filename, content_type, size_prelim, metadata }`.
///   2. Server sanitizes the filename via `formatFileName` (no UUID),
///      dedupes the Firestore record by `filename + collectionId`, and
///      returns `{ id, filename, uploadUrl }` — `filename` is the
///      verbatim sanitized name we just sent (sans the special-char
///      transform), `uploadUrl` is a signed GCS PUT URL.
///   3. PUT the file bytes at the signed URL with the right content-type.
///      GCS overwrites the same object key.
///
/// Net effect: same name → same GCS path → same Firestore row, every
/// time. The three-rule contract (upload-by-local-name,
/// download-by-remote-name, overwrite-on-same-name) is enforced
/// server-side.
///
/// KB push intentionally stays on the multipart `kb_upload_file` path —
/// the vector-store indexing pipeline runs only there. A KB twin of
/// this command is left out until the indexing pipeline is decoupled
/// (server-side fix tracked separately).
pub(crate) async fn upload_fs_via_signed_url(
    repo: &str,
    filename: &str,
    collection_id: &str,
    skills_base_url: &str,
    access_token: &str,
    subdir: Option<&str>,
) -> Result<KbUploadResult, String> {
    let path = fs_path_with_optional_subdir(repo, filename, subdir)?;
    if !path.exists() {
        return Err(format!("file not found: {}", path.display()));
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    upload_via_signed_url_inner(
        filename,
        collection_id,
        skills_base_url,
        access_token,
        bytes,
    )
    .await
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("network error: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!(
            "HTTP {}: {}",
            status,
            resp.text().await.unwrap_or_default()
        ));
    }
    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| e.to_string())
}

async fn multipart_upload(
    filename: &str,
    collection_id: &str,
    skills_base_url: &str,
    access_token: &str,
    bytes: Vec<u8>,
) -> Result<KbUploadResult, String> {
    let url = format!(
        "{}/filestorage/items/upload?collectionId={}",
        skills_base_url.trim_end_matches('/'),
        urlencode(collection_id)
    );

    let mime = mime_for(filename);
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(filename.to_string())
        .mime_str(&mime)
        .map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("metadata", "{}");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(&url)
        .header("Auth-Token", format!("Bearer {}", access_token))
        .header("Accept", "*/*")
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("network error: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, text));
    }
    let parsed: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("could not parse upload response: {} — body: {}", e, text))?;

    Ok(KbUploadResult {
        id: parsed
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        filename: parsed
            .get("metadata")
            .and_then(|m| m.get("filename"))
            .and_then(|v| v.as_str())
            .unwrap_or(filename)
            .to_string(),
        file_url: parsed
            .get("file_url")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        file_size: parsed.get("file_size").and_then(|v| v.as_u64()),
        mime_type: parsed
            .get("mime_type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

async fn upload_via_signed_url_inner(
    filename: &str,
    collection_id: &str,
    skills_base_url: &str,
    access_token: &str,
    bytes: Vec<u8>,
) -> Result<KbUploadResult, String> {
    let mime = mime_for(filename);
    let size = bytes.len() as u64;

    let request_url = format!(
        "{}/filestorage/items/upload-request?collectionId={}",
        skills_base_url.trim_end_matches('/'),
        urlencode(collection_id)
    );
    let request_body = serde_json::json!({
        "filename": filename,
        "content_type": mime,
        "size_prelim": size,
        "metadata": {},
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let request_resp = client
        .post(&request_url)
        .header("Auth-Token", format!("Bearer {}", access_token))
        .header("Content-Type", "application/json")
        .header("Accept", "*/*")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("upload-request network error: {}", e))?;

    let request_status = request_resp.status();
    let request_text = request_resp.text().await.unwrap_or_default();
    if !request_status.is_success() {
        return Err(format!(
            "upload-request HTTP {}: {}",
            request_status, request_text
        ));
    }
    let parsed: serde_json::Value = serde_json::from_str(&request_text).map_err(|e| {
        format!(
            "could not parse upload-request response: {} — body: {}",
            e, request_text
        )
    })?;

    let upload_url = parsed
        .get("uploadUrl")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            format!(
                "upload-request response missing uploadUrl: {}",
                request_text
            )
        })?;
    let server_filename = parsed
        .get("filename")
        .and_then(|v| v.as_str())
        .unwrap_or(filename)
        .to_string();
    let server_id = parsed
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // PUT the bytes to GCS. The signed URL's signature was computed
    // against `Content-Type: <mime>` — sending a different value (or
    // omitting the header) yields HTTP 403 SignatureDoesNotMatch. The
    // mime we computed locally must match what we sent in step 1.
    let put_resp = client
        .put(upload_url)
        .header("Content-Type", &mime)
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("signed PUT network error: {}", e))?;

    let put_status = put_resp.status();
    if !put_status.is_success() {
        let body = put_resp.text().await.unwrap_or_default();
        return Err(format!("signed PUT HTTP {}: {}", put_status, body));
    }

    Ok(KbUploadResult {
        id: server_id,
        filename: server_filename,
        file_url: None,
        file_size: Some(size),
        mime_type: Some(mime),
    })
}
