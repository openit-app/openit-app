// scripts.rs — Tauri command for running an arbitrary `.mjs` script
// in the project repo and capturing its stdout/stderr.
//
// Powers the "Run" affordance on each card in the
// `filestores/scripts/` folder view: click → spawn `node <script>` in
// the repo root → return the captured output to the frontend, which
// then routes the viewer to a `script-output` source that renders
// the result inline (no terminal pop-up needed).

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

use serde::Serialize;

#[derive(Serialize)]
pub struct ScriptRunOutput {
    pub stdout: String,
    pub stderr: String,
    #[serde(rename = "exitCode")]
    pub exit_code: i32,
    #[serde(rename = "durationMs")]
    pub duration_ms: u128,
}

/// `async` + `spawn_blocking` for the same reason `report_overview_run`
/// does it: Tauri runs sync command bodies on the main thread, so a
/// long-running `node …` would freeze the UI. Wrapping the spawn keeps
/// the renderer responsive while the script runs.
#[tauri::command]
pub async fn script_run(repo: String, script_path: String) -> Result<ScriptRunOutput, String> {
    tauri::async_runtime::spawn_blocking(move || run_blocking(&repo, &script_path))
        .await
        .map_err(|e| format!("background task failed: {}", e))?
}

/// Resolve the absolute filesystem path to the named interpreter
/// (`node`, `python3`, ...). Returns `None` when nothing is found.
///
/// macOS GUI apps launched from Finder / Dock inherit a restricted
/// PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) that doesn't include
/// Homebrew, so a bare `which::which("node")` regularly fails for
/// users who installed Node via Homebrew or nvm. Fall back to the
/// well-known install locations before giving up.
pub fn resolve_interpreter_path(interpreter: &str) -> Option<PathBuf> {
    if let Ok(p) = which::which(interpreter) {
        return Some(p);
    }
    #[cfg(not(target_os = "windows"))]
    {
        for dir in &[
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/opt/local/bin",
        ] {
            let candidate = PathBuf::from(dir).join(interpreter);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        let exe = if interpreter.ends_with(".exe") {
            interpreter.to_string()
        } else {
            format!("{}.exe", interpreter)
        };
        if let Ok(p) = which::which(&exe) {
            return Some(p);
        }
    }
    None
}

/// Friendly per-interpreter "not installed" message. Replaces the
/// cryptic `os error 2` users see when the OS-level spawn fails.
fn missing_interpreter_message(interpreter: &str) -> String {
    match interpreter {
        "node" => "Node.js not found. Install it from https://nodejs.org (or `brew install node`) and try again.".to_string(),
        "python3" => "Python 3 not found. Install it from https://python.org (or `brew install python`) and try again.".to_string(),
        other => format!("{} not found on this system. Install it and try again.", other),
    }
}

/// Tauri command exposed to the frontend so seed-time can bake the
/// resolved absolute path into the shebang of newly-seeded `.mjs`
/// files. Returns `None` (not `Err`) when the interpreter isn't
/// installed — the frontend treats that as "skip the rewrite, keep
/// `#!/usr/bin/env node` and let the runner surface the friendly
/// error if/when the script is actually invoked".
#[tauri::command]
pub fn script_resolve_interpreter(interpreter: String) -> Option<String> {
    resolve_interpreter_path(&interpreter).map(|p| p.to_string_lossy().to_string())
}

fn run_blocking(repo: &str, script_path: &str) -> Result<ScriptRunOutput, String> {
    let repo_path = Path::new(repo);
    let script = resolve_script(repo_path, script_path)?;

    // Reject anything outside the repo. Symlinks are followed when
    // canonicalizing, so the check here is "the resolved path lives
    // under the repo root" — defense against a UI bug or a crafted
    // path arg that points at a system binary.
    let canon_repo = repo_path
        .canonicalize()
        .map_err(|e| format!("repo not accessible: {}", e))?;
    let canon_script = script
        .canonicalize()
        .map_err(|e| format!("script not accessible: {}", e))?;
    if !canon_script.starts_with(&canon_repo) {
        return Err(format!(
            "refusing to run script outside repo root: {}",
            canon_script.display()
        ));
    }

    let interpreter = pick_interpreter(&canon_script)?;
    // Resolve to the absolute interpreter path so the spawn doesn't
    // depend on the inherited PATH (Finder-launched GUI apps lose
    // Homebrew paths, which is why `os error 2` was so common). When
    // nothing resolves, return the friendly "install Node.js"
    // message before reaching `Command::spawn`.
    //
    // Note: the friendly message is keyed off the extension-derived
    // interpreter, so a `.mjs` file that's actually Python (mis-
    // renamed by the user) surfaces "Node.js not found" even though
    // the script never needed node. Acceptable for now — the ticket
    // scope is fixing the real PATH bug, not extension sniffing.
    let interpreter_path = resolve_interpreter_path(interpreter)
        .ok_or_else(|| missing_interpreter_message(interpreter))?;
    let started = Instant::now();
    // Strip the Windows extended-path (`\\?\C:\…`) prefix before
    // handing the path to Node — Node's module resolver chokes on it
    // (`realpathSync` ends up calling lstat on just `'C:'` and errors
    // with EISDIR). Drive-letter paths are accepted by every Windows
    // API we care about so we don't need the extended form.
    let script_for_cmd = strip_unc_prefix(&canon_script);
    let cwd_for_cmd = strip_unc_prefix(&canon_repo);
    let output = Command::new(&interpreter_path)
        .arg(&script_for_cmd)
        .current_dir(&cwd_for_cmd)
        .output()
        .map_err(|e| {
            // `os error 2` (NotFound) here is unrecoverable — the
            // resolved path raced or got revoked between resolve and
            // spawn. Fall back to the friendly message either way.
            if e.kind() == std::io::ErrorKind::NotFound {
                missing_interpreter_message(interpreter)
            } else {
                format!("failed to spawn {}: {}", interpreter, e)
            }
        })?;
    let duration_ms = started.elapsed().as_millis();

    Ok(ScriptRunOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
        duration_ms,
    })
}

/// Pick the right interpreter from the file extension. Keeps the
/// frontend's "Run" button generic — the UI doesn't know whether a
/// script is JS or Python, it just routes the path here. `python3`
/// is the canonical command on modern macOS; bare `python` is a
/// foot-gun (resolves to py2 on some systems, missing entirely on
/// others).
fn pick_interpreter(script: &Path) -> Result<&'static str, String> {
    let ext = script
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mjs" | "js" | "cjs" => Ok("node"),
        "py" => Ok("python3"),
        other => Err(format!(
            "unsupported script extension '.{}': only .mjs / .js / .cjs / .py are runnable",
            other
        )),
    }
}

/// Strip the Windows `\\?\` (extended-path) prefix that `canonicalize`
/// adds on Windows. No-op on Unix. Node and many subprocess APIs don't
/// handle the extended form well — the regular `C:\…` form is what
/// every Windows tool expects.
fn strip_unc_prefix(p: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let s = p.to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            // Don't strip UNC server paths like \\?\UNC\server\share —
            // those need different handling and we don't expect them.
            if !rest.starts_with("UNC\\") {
                return PathBuf::from(rest);
            }
        }
    }
    p.to_path_buf()
}

/// Accept either a repo-relative path (e.g. `filestores/scripts/foo.mjs`)
/// or an absolute path that already includes the repo root. Both
/// callers are reasonable; normalize to absolute so the canonicalize
/// + starts_with check below is consistent.
fn resolve_script(repo: &Path, script_path: &str) -> Result<PathBuf, String> {
    let p = Path::new(script_path);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        repo.join(p)
    };
    if !abs.is_file() {
        return Err(format!("script not found: {}", abs.display()));
    }
    Ok(abs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_interpreter_message_mentions_install() {
        let msg = missing_interpreter_message("node");
        assert!(msg.contains("Node.js"), "{}", msg);
        assert!(msg.contains("nodejs.org"), "{}", msg);
    }

    #[test]
    fn missing_interpreter_message_python_mentions_install() {
        let msg = missing_interpreter_message("python3");
        assert!(msg.contains("Python"), "{}", msg);
        assert!(msg.contains("python.org"), "{}", msg);
    }

    #[test]
    fn resolve_interpreter_path_returns_absolute_when_present() {
        // `sh` is guaranteed on every Unix host the CI matrix uses;
        // on Windows we skip — `which` for `sh` may fail and the
        // Homebrew fallback dirs don't apply.
        #[cfg(not(target_os = "windows"))]
        {
            let p = resolve_interpreter_path("sh").expect("sh should exist");
            assert!(p.is_absolute(), "expected absolute path, got {:?}", p);
        }
    }

    #[test]
    fn resolve_interpreter_path_none_for_missing() {
        assert!(resolve_interpreter_path("definitely-not-a-real-bin-xyz123").is_none());
    }
}
