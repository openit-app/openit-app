use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct KbLocalFile {
    pub filename: String,
    /// Local mtime in ms since epoch. None if the file disappeared between
    /// the directory listing and the stat.
    pub mtime_ms: Option<u128>,
    pub size: u64,
}

#[derive(Serialize)]
pub struct KbRemoteFile {
    pub id: String,
    pub filename: String,
    pub signed_url: Option<String>,
    pub file_size: Option<u64>,
    pub mime_type: Option<String>,
    pub updated_at: String,
}

#[derive(Serialize, Deserialize)]
pub struct KbUploadResult {
    pub id: String,
    pub filename: String,
    pub file_url: Option<String>,
    pub file_size: Option<u64>,
    pub mime_type: Option<String>,
}
