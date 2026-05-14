use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Find a free destination filename in `dir` for a migration. If
/// `<name>` doesn't exist returns it; otherwise tries
/// `<name>.legacy`, `<name>.legacy.2`, … until a free slot is found.
/// Falls back to a timestamp-suffixed name after 99 attempts (a
/// pathological case where the user's project has a hundred
/// duplicates) — better than overwriting silently. The earlier
/// single-`.legacy` policy could lose data on a re-run when the
/// user had already accepted a previous `.legacy` rename.
fn unique_legacy_dest(dir: &Path, name: &OsStr) -> PathBuf {
    let direct = dir.join(name);
    if !direct.exists() {
        return direct;
    }
    let base = name.to_string_lossy().into_owned();
    let first = format!("{}.legacy", base);
    let candidate = dir.join(&first);
    if !candidate.exists() {
        return candidate;
    }
    for n in 2..100u32 {
        let next = format!("{}.legacy.{}", base, n);
        let candidate = dir.join(&next);
        if !candidate.exists() {
            return candidate;
        }
    }
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    dir.join(format!("{}.legacy.{}", base, ms))
}

#[derive(Serialize)]
pub struct BootstrapResult {
    pub path: String,
    pub created: bool,
}

/// Make sure the vault directory exists and has the standard layout.
/// Accepts an arbitrary absolute path. Returns the path and whether
/// it was newly created. When `vault_path` is empty, defaults to
/// `~/OpenIT/Personal/`.
#[tauri::command]
pub fn project_bootstrap(vault_path: Option<String>) -> Result<BootstrapResult, String> {
    let path: PathBuf = match vault_path.as_deref() {
        Some(p) if !p.is_empty() => PathBuf::from(p),
        _ => {
            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .map_err(|_| "HOME/USERPROFILE not set".to_string())?;
            [&home, "OpenIT"].iter().collect()
        }
    };

    let already_existed = path.exists();
    if !already_existed {
        fs::create_dir_all(&path).map_err(|e| format!("create_dir_all failed: {}", e))?;

        // Create standard subdirectories so they appear in the file
        // explorer even if empty. The three core datastore dirs
        // (tickets, people, conversations) are created upfront so the
        // explorer + Claude both see them on day-one — without this,
        // `databases/conversations/` only appeared after the first
        // turn was logged, which felt incomplete to users browsing
        // the layout.
        for dir in &[
            "agents",
            "databases",
            "databases/tickets",
            "databases/people",
            "databases/conversations",
            "databases/access",
            "databases/assets",
            // Filestore split into purpose-specific collections.
            // `attachments` is operational (per-ticket file uploads from
            // the chat intake); `library` is curated (admin's go-to
            // runbooks). `commands` holds the admin-facing slash
            // commands; `scripts` holds runnable automations. All four
            // share the filestore sync engine when cloud is connected.
            "filestores",
            "filestores/attachments",
            "filestores/library",
            "filestores/commands",
            "filestores/scripts",
            // Flat KB directory: all articles live directly in
            // `knowledge/`.
            "knowledge",
            // On-demand markdown reports — populated by the
            // "Generate overview" button in the explorer (which shells
            // out to .claude/scripts/report-overview.mjs) and by the
            // /report command. Always create so the sidebar entry isn't
            // empty on a fresh project.
            "reports",
            // Audit logs of agent turns (per-ticket folders with one
            // JSON per turn). Promoted out of `.openit/agent-traces/`
            // in the 2026-05 restructure so admins can browse them
            // alongside the other primitives. The intake server writes
            // these; admins don't.
            "traces",
        ] {
            fs::create_dir_all(path.join(dir))
                .map_err(|e| format!("create_dir failed for {}: {}", dir, e))?;
        }
    }

    // Idempotent layout maintenance: ensure the standard filestore +
    // knowledge-base subdirs exist for every project on every open,
    // even ones bootstrapped before the splits. Cheap to create, lets
    // the explorer render the canonical structure without waiting for
    // first-use.
    let _ = fs::create_dir_all(path.join("filestores").join("attachments"));
    let _ = fs::create_dir_all(path.join("filestores").join("library"));
    let _ = fs::create_dir_all(path.join("filestores").join("commands"));
    let _ = fs::create_dir_all(path.join("filestores").join("scripts"));
    let _ = fs::create_dir_all(path.join("knowledge"));
    let _ = fs::create_dir_all(path.join("traces"));
    // Same idempotent guard for `reports/` so projects bootstrapped
    // before the reports feature shipped get the dir on next open.
    let _ = fs::create_dir_all(path.join("reports"));

    // Remove the legacy empty `workflows/` directory that was created
    // on first launch in versions <1.2.1. The 2026-05 restructure
    // dropped workflows from the agreed vault layout but the
    // first-launch bootstrap list kept creating it. `remove_dir` only
    // succeeds when the directory is empty, so any admin who has
    // started putting their own content there is safe.
    let _ = fs::remove_dir(path.join("workflows"));

    // First-launch `.openit/config.json` with defaults. Gives admins a
    // discoverable surface to tune without reading docs — file is in
    // the explorer's "show system files" view, structure is obvious.
    // Idempotent: only writes when the file is missing, so admin
    // overrides survive across app launches.
    let openit_dir = path.join(".openit");
    let config_path = openit_dir.join("config.json");
    if !config_path.exists() {
        let _ = fs::create_dir_all(&openit_dir);
        if let Ok(json) =
            serde_json::to_string_pretty(&crate::openit_config::OpenitConfig::default())
        {
            let _ = fs::write(&config_path, format!("{}\n", json));
        }
    }

    // First-launch Getting Started page. Idempotent: only writes when
    // the file is missing, so user edits survive across app launches.
    // `{{INTAKE_URL}}` is substituted by the markdown viewer at render
    // time (the URL changes per app launch — different OS-assigned
    // port — so a static URL can't be baked in here).
    let getting_started_path = path.join("getting-started.html");
    if !getting_started_path.exists() {
        let getting_started = include_str!("getting-started.html");
        let _ = fs::write(&getting_started_path, getting_started);
    }
    // Clean up legacy .md welcome page from older installs.
    let legacy_md = path.join("getting-started.md");
    if legacy_md.exists() {
        let _ = fs::remove_file(&legacy_md);
    }

    // One-time migration: legacy `filestore/<file>` content moves into
    // the new `filestores/library/<file>` location. Idempotent — runs
    // only when the legacy dir exists; once empty it is removed so
    // the bootstrap loop can't recreate it on a future run. Files
    // shadowed by a same-named entry already in `library/` are kept
    // under their original names with a `.legacy` suffix to avoid
    // silent overwrites.
    let legacy_filestore = path.join("filestore");
    if legacy_filestore.is_dir() {
        let library_dir = path.join("filestores").join("library");
        if let Ok(entries) = fs::read_dir(&legacy_filestore) {
            for entry in entries.flatten() {
                let from = entry.path();
                let name = entry.file_name();
                let to = unique_legacy_dest(&library_dir, &name);
                let _ = fs::rename(&from, &to);
            }
        }
        // Drop the legacy dir if it's empty after migration. Leave it
        // alone if the rename loop failed to drain it — better to
        // surface stranded files than silently delete.
        let _ = fs::remove_dir(&legacy_filestore);
    }

    // Legacy migration: singular `knowledge-base/` and plural
    // `knowledge-bases/` both fold into the canonical flat
    // `knowledge/`. The plural form was used during the 2026-05
    // restructure before the rename; covering both means any vault
    // touched during that window heals on next open.
    for legacy_name in ["knowledge-base", "knowledge-bases"] {
        let legacy_kb = path.join(legacy_name);
        if legacy_kb.is_dir() {
            let kb_dir = path.join("knowledge");
            if let Ok(entries) = fs::read_dir(&legacy_kb) {
                for entry in entries.flatten() {
                    let from = entry.path();
                    let name = entry.file_name();
                    let to = unique_legacy_dest(&kb_dir, &name);
                    let _ = fs::rename(&from, &to);
                }
            }
            let _ = fs::remove_dir(&legacy_kb);
        }
    }

    // Legacy migration: `filestores/skills/` → `filestores/commands/`.
    // "Skills" was Claude-Code-internal terminology that leaked into
    // the admin-facing layout; the renamed slot is `commands/`. Move
    // any user-edited command bodies over so they keep working under
    // the new path (the write-once gate in skillsSync preserves them
    // after this).
    let legacy_skills = path.join("filestores").join("skills");
    if legacy_skills.is_dir() {
        let commands_dir = path.join("filestores").join("commands");
        let _ = fs::create_dir_all(&commands_dir);
        if let Ok(entries) = fs::read_dir(&legacy_skills) {
            for entry in entries.flatten() {
                let from = entry.path();
                let name = entry.file_name();
                let to = unique_legacy_dest(&commands_dir, &name);
                let _ = fs::rename(&from, &to);
            }
        }
        let _ = fs::remove_dir(&legacy_skills);
    }

    // Legacy migration: `.openit/agent-traces/` → top-level `traces/`.
    // The 2026-05 restructure promoted trace storage out of the
    // hidden runtime dir so admins (and CC) can browse audit logs
    // alongside the other primitives.
    let legacy_traces = path.join(".openit").join("agent-traces");
    if legacy_traces.is_dir() {
        let traces_dir = path.join("traces");
        let _ = fs::create_dir_all(&traces_dir);
        if let Ok(entries) = fs::read_dir(&legacy_traces) {
            for entry in entries.flatten() {
                let from = entry.path();
                let name = entry.file_name();
                let to = unique_legacy_dest(&traces_dir, &name);
                let _ = fs::rename(&from, &to);
            }
        }
        let _ = fs::remove_dir(&legacy_traces);
    }

    // Flatten migration: move articles from `knowledge/default/`
    // (and any other collection subdirs) up into `knowledge/`.
    // Projects created before the flat-KB change may have articles
    // nested in subdirectories; this hoists them on next open.
    let kb_dir = path.join("knowledge");
    if kb_dir.is_dir() {
        if let Ok(entries) = fs::read_dir(&kb_dir) {
            for entry in entries.flatten() {
                let sub = entry.path();
                if !sub.is_dir() {
                    continue;
                }
                // Move every file from the subdirectory up into knowledge/
                if let Ok(children) = fs::read_dir(&sub) {
                    for child in children.flatten() {
                        let from = child.path();
                        if !from.is_file() {
                            continue;
                        }
                        let name = child.file_name();
                        let to = unique_legacy_dest(&kb_dir, &name);
                        let _ = fs::rename(&from, &to);
                    }
                }
                // Remove the now-empty subdirectory
                let _ = fs::remove_dir(&sub);
            }
        }
    }

    Ok(BootstrapResult {
        path: path.to_string_lossy().into_owned(),
        created: !already_existed,
    })
}
