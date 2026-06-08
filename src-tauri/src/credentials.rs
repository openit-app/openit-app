// credentials.rs — secure, local, vault-safe credential store for
// scripts and Claude-run commands.
//
// The problem this solves: admins were pasting API tokens directly into
// `filestores/scripts/*.mjs` and `filestores/commands/*.md`. Those files
// live in the vault, which syncs to Dropbox / Google Drive — so the
// secrets leaked to every synced device and the cloud dashboard.
//
// The fix: store secret *values* in the OS secure store (macOS Keychain,
// Windows Credential Manager, libsecret on Linux) via the `keyring`
// crate, and keep only a non-secret *index of names* in the app data
// directory (NOT the vault). Scripts and commands reference a credential
// by its environment-variable name; the value is injected into the child
// process environment at run time and never written to disk in the clear.
//
// Cross-platform note: `keyring` abstracts all three OS backends behind
// one API (`apple-native`, `windows-native`, `linux-native-sync-persistent`
// features in Cargo.toml), so there is a single code path here — no
// `cfg(target_os = ...)` branching. The Windows Credential Manager path is
// therefore exercised by the same code that runs on macOS, and is
// compile-checked by the Windows CI job.

use std::path::PathBuf;

use keyring::Entry;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

/// Keychain service identifier. Shared with `keychain.rs` so all OpenIT
/// secrets live under one logical service in the OS store.
const SERVICE: &str = "ai.pinkfish.openit";

/// Prefix applied to a credential name to form its keychain slot. Keeps
/// credential slots from colliding with the generic `keychain_*` slots
/// and any future namespaced secrets.
const CRED_SLOT_PREFIX: &str = "cred.";

/// Reserved environment-variable names a credential may NOT use. Credential
/// values are injected into child-process environments *after* PATH (and
/// other vars) are deliberately set up — using `Command::env`, which
/// OVERRIDES the inherited value. A credential literally named `PATH`,
/// `NODE_OPTIONS`, `DYLD_INSERT_LIBRARIES`, etc. would therefore hijack the
/// spawned environment, breaking Claude Code / script spawning or enabling
/// injection. We reject these outright.
///
/// Names are stored upper-case (the charset check forces uppercase), so an
/// exact match against this upper-case list is a case-insensitive check in
/// practice. Covers POSIX, Windows, and a few injection-sensitive vars.
/// Mirror of `RESERVED_CREDENTIAL_NAMES` in `src/lib/api.ts` — keep in sync.
const RESERVED_CREDENTIAL_NAMES: &[&str] = &[
    // POSIX / shell
    "PATH",
    "HOME",
    "PWD",
    "OLDPWD",
    "SHELL",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "HOSTNAME",
    "LANG",
    "LC_ALL",
    "TERM",
    "DISPLAY",
    "IFS",
    "ENV",
    "BASH_ENV",
    "PROMPT_COMMAND",
    "PS1",
    "PS2",
    // dynamic-loader / runtime injection
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "NODE_OPTIONS",
    "PYTHONPATH",
    // Windows
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PATHEXT",
    "HOMEDRIVE",
    "HOMEPATH",
];

/// Whether `name` is a reserved environment-variable name (see
/// `RESERVED_CREDENTIAL_NAMES`). Compared against the upper-case canonical
/// form; since valid names are already all-uppercase this is exact match.
fn is_reserved_credential_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    RESERVED_CREDENTIAL_NAMES.contains(&upper.as_str())
}

/// A credential name is treated as an environment-variable name. The
/// conservative regex `^[A-Z_][A-Z0-9_]*$` is the safe intersection of
/// what POSIX shells and the Windows `cmd`/PowerShell environments accept
/// without quoting surprises. Rejecting lowercase keeps the contract
/// unambiguous and matches the `process.env.MY_SECRET` convention the
/// authoring docs teach.
///
/// Beyond the charset, reserved names that would hijack the spawned child
/// environment (`PATH`, `HOME`, `NODE_OPTIONS`, ...) are rejected — see
/// `is_reserved_credential_name`.
pub fn is_valid_credential_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c == '_' || c.is_ascii_uppercase() => {}
        _ => return false,
    }
    if !chars.all(|c| c == '_' || c.is_ascii_uppercase() || c.is_ascii_digit()) {
        return false;
    }
    !is_reserved_credential_name(name)
}

/// Non-secret index of saved credential names. Persisted as JSON in the
/// app data directory — explicitly NOT in the vault, so it never syncs.
/// The index lets the UI list saved variables without enumerating the OS
/// keychain (which is awkward and prompts on some platforms).
#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(default)]
pub struct CredentialIndex {
    /// Sorted, de-duplicated credential names.
    pub names: Vec<String>,
}

impl CredentialIndex {
    /// Insert a name, keeping the list sorted and unique.
    fn insert(&mut self, name: &str) {
        if !self.names.iter().any(|n| n == name) {
            self.names.push(name.to_string());
            self.names.sort();
        }
    }

    /// Remove a name. Returns whether it was present.
    fn remove(&mut self, name: &str) -> bool {
        let before = self.names.len();
        self.names.retain(|n| n != name);
        self.names.len() != before
    }
}

/// Path to the on-disk index. Lives next to `state.json` in the app data
/// directory so it is per-user, machine-local, and outside any vault.
fn index_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app_data_dir: {}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("credentials.json"))
}

fn load_index<R: Runtime>(app: &AppHandle<R>) -> Result<CredentialIndex, String> {
    let path = index_path(app)?;
    if !path.exists() {
        return Ok(CredentialIndex::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn save_index<R: Runtime>(app: &AppHandle<R>, index: &CredentialIndex) -> Result<(), String> {
    let path = index_path(app)?;
    let json = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Keychain entry for a credential name. The slot is the prefixed name so
/// it never collides with the generic `keychain_*` API's slots.
fn cred_entry(name: &str) -> Result<Entry, String> {
    let slot = format!("{}{}", CRED_SLOT_PREFIX, name);
    Entry::new(SERVICE, &slot).map_err(|e| e.to_string())
}

/// List saved credential names. Never returns values.
#[tauri::command]
pub fn credentials_list<R: Runtime>(app: AppHandle<R>) -> Result<Vec<String>, String> {
    Ok(load_index(&app)?.names)
}

/// Save (create or overwrite) a credential. The value goes to the OS
/// secure store; only the name is added to the local index. The value is
/// never logged — see the deliberate absence of any `eprintln!` of `value`.
#[tauri::command]
pub fn credentials_set<R: Runtime>(
    app: AppHandle<R>,
    name: String,
    value: String,
) -> Result<(), String> {
    if is_reserved_credential_name(&name) {
        return Err(format!(
            "credential name '{}' is a reserved environment variable and cannot be used; \
             it would override the spawned process environment (PATH, HOME, NODE_OPTIONS, \
             etc.). Choose a distinct name like SALESFORCE_TOKEN",
            name
        ));
    }
    if !is_valid_credential_name(&name) {
        return Err(format!(
            "invalid credential name '{}': must match ^[A-Z_][A-Z0-9_]*$ (e.g. SALESFORCE_TOKEN)",
            name
        ));
    }
    if value.is_empty() {
        return Err("credential value must not be empty".to_string());
    }
    let entry = cred_entry(&name)?;
    entry.set_password(&value).map_err(|e| e.to_string())?;
    let mut index = load_index(&app)?;
    index.insert(&name);
    save_index(&app, &index)
}

/// Delete a credential: remove the secret from the OS store and the name
/// from the index. Idempotent — deleting a missing credential succeeds.
#[tauri::command]
pub fn credentials_delete<R: Runtime>(app: AppHandle<R>, name: String) -> Result<(), String> {
    let entry = cred_entry(&name)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(err) => return Err(err.to_string()),
    }
    let mut index = load_index(&app)?;
    if index.remove(&name) {
        save_index(&app, &index)?;
    }
    Ok(())
}

/// Resolve all saved credentials to `(name, value)` pairs for injection
/// into a child process environment. A name present in the index whose
/// keychain value is missing (e.g. the user cleared it in Keychain
/// Access) is skipped rather than failing the whole spawn.
///
/// This is the runtime bridge used by `scripts::script_run` and
/// `pty::pty_spawn`. It is intentionally best-effort and silent: a script
/// that needs a credential will fail on its own if the value is absent,
/// which is clearer than blocking every run.
pub fn load_credential_env<R: Runtime>(app: &AppHandle<R>) -> Vec<(String, String)> {
    let index = match load_index(app) {
        Ok(i) => i,
        Err(_) => return Vec::new(),
    };
    resolve_credentials(&index.names, |name| {
        cred_entry(name).ok().and_then(|e| e.get_password().ok())
    })
}

/// Pure resolver split out for testing: given the indexed names and a
/// lookup closure (the real one reads the keychain; tests pass a map),
/// return the `(name, value)` pairs that resolved. Names that don't
/// resolve are dropped.
fn resolve_credentials<F>(names: &[String], lookup: F) -> Vec<(String, String)>
where
    F: Fn(&str) -> Option<String>,
{
    names
        .iter()
        .filter_map(|name| lookup(name).map(|value| (name.clone(), value)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_names_accept_env_style_identifiers() {
        assert!(is_valid_credential_name("SALESFORCE_TOKEN"));
        assert!(is_valid_credential_name("_PRIVATE"));
        assert!(is_valid_credential_name("API_KEY_2"));
        assert!(is_valid_credential_name("X"));
    }

    #[test]
    fn invalid_names_are_rejected() {
        assert!(!is_valid_credential_name("")); // empty
        assert!(!is_valid_credential_name("lowercase"));
        assert!(!is_valid_credential_name("2LEADING_DIGIT"));
        assert!(!is_valid_credential_name("HAS-DASH"));
        assert!(!is_valid_credential_name("HAS SPACE"));
        assert!(!is_valid_credential_name("HAS.DOT"));
        assert!(!is_valid_credential_name("lowerThenUpper"));
    }

    #[test]
    fn reserved_env_names_are_rejected() {
        // A credential whose name collides with a critical env var would
        // hijack the spawned child environment — must be rejected even
        // though it passes the charset check.
        for reserved in [
            "PATH",
            "HOME",
            "PWD",
            "TMPDIR",
            "SHELL",
            "USER",
            "NODE_OPTIONS",
            "PYTHONPATH",
            "LD_PRELOAD",
            "LD_LIBRARY_PATH",
            "DYLD_INSERT_LIBRARIES",
            "DYLD_LIBRARY_PATH",
            "SYSTEMROOT",
            "WINDIR",
            "COMSPEC",
            "USERPROFILE",
            "APPDATA",
            "PATHEXT",
            "IFS",
            "BASH_ENV",
        ] {
            assert!(
                !is_valid_credential_name(reserved),
                "reserved name {reserved} must be rejected"
            );
            assert!(
                is_reserved_credential_name(reserved),
                "{reserved} should be flagged reserved"
            );
        }
    }

    #[test]
    fn reserved_check_is_case_insensitive() {
        // Lower/mixed case fails the charset check anyway, but the reserved
        // helper itself must match case-insensitively as a defense in depth.
        assert!(is_reserved_credential_name("path"));
        assert!(is_reserved_credential_name("Node_Options"));
    }

    #[test]
    fn normal_names_pass_despite_reserved_list() {
        // Plausible real credential names must still be accepted.
        for ok in ["SALESFORCE_TOKEN", "MY_API_KEY", "GITHUB_PAT", "PATH_TOKEN"] {
            assert!(is_valid_credential_name(ok), "{ok} should be valid");
            assert!(!is_reserved_credential_name(ok), "{ok} is not reserved");
        }
    }

    #[test]
    fn index_insert_is_sorted_and_unique() {
        let mut idx = CredentialIndex::default();
        idx.insert("B_TOKEN");
        idx.insert("A_TOKEN");
        idx.insert("B_TOKEN"); // duplicate ignored
        assert_eq!(idx.names, vec!["A_TOKEN", "B_TOKEN"]);
    }

    #[test]
    fn index_remove_reports_presence() {
        let mut idx = CredentialIndex::default();
        idx.insert("A_TOKEN");
        assert!(idx.remove("A_TOKEN"));
        assert!(!idx.remove("A_TOKEN")); // already gone
        assert!(idx.names.is_empty());
    }

    #[test]
    fn index_serialization_round_trips() {
        let mut idx = CredentialIndex::default();
        idx.insert("FOO");
        idx.insert("BAR");
        let json = serde_json::to_string(&idx).expect("serialize");
        let parsed: CredentialIndex = serde_json::from_str(&json).expect("parse");
        assert_eq!(parsed, idx);
    }

    #[test]
    fn legacy_or_empty_index_deserializes_to_default() {
        // An empty object (or a file written before any field existed)
        // must load cleanly thanks to #[serde(default)].
        let parsed: CredentialIndex = serde_json::from_str("{}").expect("parse empty");
        assert_eq!(parsed, CredentialIndex::default());
    }

    #[test]
    fn resolve_credentials_returns_only_found_values() {
        let names = vec![
            "PRESENT_ONE".to_string(),
            "MISSING".to_string(),
            "PRESENT_TWO".to_string(),
        ];
        let resolved = resolve_credentials(&names, |name| match name {
            "PRESENT_ONE" => Some("v1".to_string()),
            "PRESENT_TWO" => Some("v2".to_string()),
            _ => None, // MISSING is dropped, not an error
        });
        assert_eq!(
            resolved,
            vec![
                ("PRESENT_ONE".to_string(), "v1".to_string()),
                ("PRESENT_TWO".to_string(), "v2".to_string()),
            ]
        );
    }

    #[test]
    fn resolve_credentials_empty_when_nothing_indexed() {
        let resolved = resolve_credentials(&[], |_| Some("x".to_string()));
        assert!(resolved.is_empty());
    }
}
