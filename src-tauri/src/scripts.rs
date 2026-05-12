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
    let started = Instant::now();
    // Strip the Windows extended-path (`\\?\C:\…`) prefix before
    // handing the path to Node — Node's module resolver chokes on it
    // (`realpathSync` ends up calling lstat on just `'C:'` and errors
    // with EISDIR). Drive-letter paths are accepted by every Windows
    // API we care about so we don't need the extended form.
    let script_for_cmd = strip_unc_prefix(&canon_script);
    let cwd_for_cmd = strip_unc_prefix(&canon_repo);
    let output = Command::new(interpreter)
        .arg(&script_for_cmd)
        .current_dir(&cwd_for_cmd)
        .output()
        .map_err(|e| format!("failed to spawn {}: {}", interpreter, e))?;
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
