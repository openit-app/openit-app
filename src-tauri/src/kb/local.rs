use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::types::KbLocalFile;

// Flat KB directory: all articles live directly in `knowledge/`.
pub(crate) const KB_DIR: &str = "knowledge";

// Filestore default directory.
pub(crate) const FS_DIR: &str = "filestores/library";

pub(crate) fn kb_dir(repo: &str) -> PathBuf {
    Path::new(repo).join(KB_DIR)
}

pub(crate) fn fs_dir(repo: &str) -> PathBuf {
    Path::new(repo).join(FS_DIR)
}

pub(crate) fn ensure_dir(p: &Path) -> Result<(), String> {
    fs::create_dir_all(p).map_err(|e| e.to_string())
}

/// Resolve `<repo>/knowledge/<filename>`. The `subdir` parameter
/// is accepted for API backwards compatibility but ignored — all KB
/// files live in the flat `knowledge/` directory.
pub(crate) fn kb_path_with_optional_subdir(
    repo: &str,
    filename: &str,
    _subdir: Option<&str>,
) -> Result<PathBuf, String> {
    safe_kb_path(repo, filename)
}

/// Resolve a `<repo>/knowledge/<filename>` path and assert it stays
/// inside the KB directory. Guards against `..` segments, absolute paths, or
/// nested separators sneaking in via server responses or future drag sources.
/// `filename` must be a single path component (no directory parts).
pub(crate) fn safe_kb_path(repo: &str, filename: &str) -> Result<PathBuf, String> {
    if filename.is_empty() {
        return Err("filename is empty".into());
    }
    if filename.contains('/') || filename.contains('\\') {
        return Err(format!(
            "filename must not contain path separators: {}",
            filename
        ));
    }
    let as_path = Path::new(filename);
    if as_path.is_absolute() || as_path.components().count() != 1 {
        return Err(format!("invalid filename: {}", filename));
    }
    if filename == "." || filename == ".." {
        return Err(format!("invalid filename: {}", filename));
    }
    Ok(kb_dir(repo).join(filename))
}

/// Reject a filename that contains separators, is "." or "..", is
/// absolute, or contains anything other than a single normal component.
/// Without this, a server-supplied "../../etc/passwd" or absolute path
/// would let the caller write outside the intended subdir.
pub(crate) fn validate_filename(filename: &str) -> Result<(), String> {
    if filename.is_empty() {
        return Err("filename is empty".into());
    }
    if filename.contains('/') || filename.contains('\\') {
        return Err(format!(
            "filename must not contain path separators: {}",
            filename
        ));
    }
    if filename == "." || filename == ".." {
        return Err(format!("invalid filename: {}", filename));
    }
    let as_path = Path::new(filename);
    if as_path.is_absolute() || as_path.components().count() != 1 {
        return Err(format!("invalid filename: {}", filename));
    }
    Ok(())
}

/// Reject a subdir path that's absolute or contains any non-Normal
/// component (e.g. ".." which escapes upward, or root-prefixed). The
/// subdir is constructed from server-supplied collection names —
/// `openit-../../evil` would otherwise produce
/// `filestores/../../evil` and let downloads escape the repo entirely.
pub(crate) fn validate_subdir(subdir: &str) -> Result<(), String> {
    if subdir.is_empty() {
        return Err("subdir must not be empty".to_string());
    }
    let p = Path::new(subdir);
    if p.is_absolute() {
        return Err(format!("subdir must be relative: {}", subdir));
    }
    for c in p.components() {
        if !matches!(c, std::path::Component::Normal(_)) {
            return Err(format!("subdir contains invalid component: {}", subdir));
        }
    }
    Ok(())
}

/// Helper to build a filestore path with optional subdirectory.
/// If subdir is provided, the final path is <repo>/<subdir>/<filename>.
/// If subdir is not provided, uses the default filestores/library directory.
pub(crate) fn fs_path_with_optional_subdir(
    repo: &str,
    filename: &str,
    subdir: Option<&str>,
) -> Result<PathBuf, String> {
    validate_filename(filename)?;
    let base_dir = if let Some(subdir) = subdir {
        validate_subdir(subdir)?;
        Path::new(repo).join(subdir)
    } else {
        fs_dir(repo)
    };
    Ok(base_dir.join(filename))
}

/// Validate that `name` is safe to use as a filename component (used by
/// entity_state_load/save to compute `.openit/<name>-state.json`). Rejects
/// path separators, leading dots, and anything outside a small whitelist.
pub(crate) fn validate_state_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("state name is empty".into());
    }
    if name.contains('/') || name.contains('\\') || name.starts_with('.') {
        return Err(format!("invalid state name: {}", name));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(format!("invalid state name: {}", name));
    }
    Ok(())
}

/// Returns true if the file extension is supported by the knowledge base.
/// Based on firebase-helpers/functions/src/utils/llm-supported-types.ts
pub(crate) fn is_kb_supported(filename: &str) -> bool {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        ext.as_str(),
        "pdf"
            | "txt"
            | "md"
            | "markdown"
            | "json"
            | "csv"
            | "docx"
            | "xlsx"
            | "pptx"
            | "jpg"
            | "jpeg"
            | "png"
            | "gif"
            | "webp"
    )
}

/// Best-effort MIME from extension. Server detects, so this is just a hint.
pub(crate) fn mime_for(filename: &str) -> String {
    let ext = Path::new(filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "md" | "markdown" => "text/markdown",
        "txt" => "text/plain",
        "json" => "application/json",
        "yaml" | "yml" => "text/yaml",
        "html" | "htm" => "text/html",
        "csv" => "text/csv",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// Percent-encode `s` per RFC 3986 unreserved set, encoding each UTF-8 byte
/// individually so non-ASCII (e.g. accented collection names) round-trips
/// correctly. `c as u32` would emit the codepoint, which is wrong for any
/// multi-byte char.
pub(crate) fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// List flat regular-file entries under `<repo>/<subdir>` as `KbLocalFile`
/// records (filename + mtime_ms + size). Skips dotfiles. Replaces the
/// three near-identical `kb_list_local` / `fs_store_list_local` /
/// `datastore_list_local` commands.
///
/// Caller-side filtering (e.g. datastore's `_schema.json` skip, requiring
/// `.json`) is done in the TS adapter, not here — keeps this command a
/// dumb file-system primitive.
pub(crate) fn list_local_files(repo: &str, subdir: &str) -> Result<Vec<KbLocalFile>, String> {
    validate_subdir(subdir)?;
    let dir = Path::new(repo).join(subdir);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if name.starts_with('.') {
            continue;
        }
        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mtime_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_millis());
        out.push(KbLocalFile {
            filename: name,
            mtime_ms,
            size: metadata.len(),
        });
    }
    out.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fs_path_with_optional_subdir_rejects_dot_dot() {
        // ".." has no path separators so the basic guard wouldn't catch it,
        // but joining ".." onto the subdir resolves to its parent —
        // letting a server-supplied filename escape the intended dir.
        assert!(fs_path_with_optional_subdir("/repo", "..", Some("filestores/library")).is_err());
        assert!(fs_path_with_optional_subdir("/repo", ".", Some("filestores/library")).is_err());
    }

    #[test]
    fn fs_path_with_optional_subdir_rejects_absolute() {
        assert!(fs_path_with_optional_subdir("/repo", "/etc/passwd", None).is_err());
    }

    #[test]
    fn fs_path_with_optional_subdir_accepts_normal_filename() {
        let p = fs_path_with_optional_subdir("/repo", "doc.md", Some("filestores/library"))
            .expect("should accept a normal filename");
        assert!(p.ends_with("filestores/library/doc.md"));
    }

    #[test]
    fn fs_path_with_optional_subdir_rejects_traversal_in_subdir() {
        // The subdir is built from server-supplied collection names. A
        // collection named "openit-../../evil" would otherwise produce
        // "filestores/../../evil" and let downloads escape the repo.
        assert!(
            fs_path_with_optional_subdir("/repo", "doc.md", Some("filestores/../../evil")).is_err()
        );
        assert!(fs_path_with_optional_subdir("/repo", "doc.md", Some("..")).is_err());
        assert!(fs_path_with_optional_subdir("/repo", "doc.md", Some("/etc")).is_err());
        assert!(fs_path_with_optional_subdir("/repo", "doc.md", Some("")).is_err());
    }

    #[test]
    fn validate_filename_basics() {
        assert!(validate_filename("doc.md").is_ok());
        assert!(validate_filename("with spaces.txt").is_ok());
        assert!(validate_filename("").is_err());
        assert!(validate_filename(".").is_err());
        assert!(validate_filename("..").is_err());
        assert!(validate_filename("a/b").is_err());
        assert!(validate_filename("a\\b").is_err());
        assert!(validate_filename("/abs").is_err());
    }

    #[test]
    fn validate_subdir_basics() {
        assert!(validate_subdir("filestores/library").is_ok());
        assert!(validate_subdir("filestores/docs-123").is_ok());
        assert!(validate_subdir("").is_err()); // empty string rejected; use None for repo root
        assert!(validate_subdir("..").is_err());
        assert!(validate_subdir("a/../b").is_err());
        assert!(validate_subdir("/abs").is_err());
        assert!(validate_subdir("./relative").is_err());
    }

    #[test]
    fn urlencode_handles_ascii_unreserved() {
        assert_eq!(urlencode("abcXYZ012-_.~"), "abcXYZ012-_.~");
    }

    #[test]
    fn urlencode_encodes_reserved_ascii() {
        assert_eq!(urlencode("a/b c"), "a%2Fb%20c");
        assert_eq!(urlencode("a+b&c=d"), "a%2Bb%26c%3Dd");
    }

    #[test]
    fn urlencode_encodes_utf8_bytes_not_codepoints() {
        // `é` is U+00E9 — codepoint 0xE9 — but UTF-8 is the two bytes
        // 0xC3 0xA9. The old impl emitted "%E9"; we want "%C3%A9".
        assert_eq!(urlencode("é"), "%C3%A9");
        assert_eq!(urlencode("café"), "caf%C3%A9");
        // 4-byte char (😀) → F0 9F 98 80
        assert_eq!(urlencode("😀"), "%F0%9F%98%80");
    }

    #[test]
    fn safe_kb_path_accepts_plain_filename() {
        let p = safe_kb_path("/tmp/repo", "notes.md").unwrap();
        assert!(p.ends_with("knowledge/notes.md"));
        assert!(!p.ends_with("knowledge/default/notes.md"));
    }

    #[test]
    fn safe_kb_path_rejects_traversal_and_separators() {
        assert!(safe_kb_path("/tmp/repo", "../etc/passwd").is_err());
        assert!(safe_kb_path("/tmp/repo", "../../etc/passwd").is_err());
        assert!(safe_kb_path("/tmp/repo", "sub/dir/file.md").is_err());
        assert!(safe_kb_path("/tmp/repo", "/abs/path.md").is_err());
        assert!(safe_kb_path("/tmp/repo", "..").is_err());
        assert!(safe_kb_path("/tmp/repo", ".").is_err());
        assert!(safe_kb_path("/tmp/repo", "").is_err());
        assert!(safe_kb_path("/tmp/repo", "a\\b.md").is_err());
    }

    #[test]
    fn safe_kb_path_allows_dotfiles_and_spaces() {
        // Leading-dot files are filtered out elsewhere (kb_list_local skips
        // them); the path resolver itself shouldn't reject them.
        assert!(safe_kb_path("/tmp/repo", ".env").is_ok());
        assert!(safe_kb_path("/tmp/repo", "Q1 plan.md").is_ok());
        assert!(safe_kb_path("/tmp/repo", "café notes.md").is_ok());
    }

    #[test]
    fn kb_path_with_optional_subdir_always_uses_flat_dir() {
        // subdir is ignored — all KB files go to knowledge/
        let p = kb_path_with_optional_subdir("/tmp/repo", "notes.md", None).unwrap();
        assert!(p.ends_with("knowledge/notes.md"));
        let p2 = kb_path_with_optional_subdir("/tmp/repo", "notes.md", Some("knowledge/runbooks"))
            .unwrap();
        assert!(p2.ends_with("knowledge/notes.md"));
    }

    #[test]
    fn kb_path_with_optional_subdir_rejects_filename_separators() {
        assert!(kb_path_with_optional_subdir(
            "/tmp/repo",
            "sub/dir/file.md",
            Some("knowledge/runbooks")
        )
        .is_err());
        assert!(kb_path_with_optional_subdir("/tmp/repo", "", None).is_err());
    }
}
