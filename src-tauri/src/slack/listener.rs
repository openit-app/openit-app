// Slack listener supervisor task — owns the Node child process,
// drains heartbeat/error lines from stderr, observes stop signals
// and unexpected exits.

use parking_lot::Mutex as PMutex;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, Runtime};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use super::{
    set_active_bot_token, HeartbeatPayload, RunningListener, LISTENER_REPO_REL,
    LISTENER_RESOURCE_REL, LISTENER_STOP_GRACE_SECS,
};

/// One task per listener: owns the Child + stderr, drains heartbeat
/// and error lines, observes either a stop signal or an unexpected
/// child exit, ensures the child is dead, then clears
/// `state.inner` and writes `last_exit_error` if appropriate.
///
/// Single owner = simpler than splitting into a "log task" and a
/// "wait task". The select! between stderr line read, child wait,
/// and the stop signal is the central state machine.
#[allow(clippy::too_many_arguments)]
pub(super) fn spawn_supervisor_task(
    mut child: tokio::process::Child,
    stderr: tokio::process::ChildStderr,
    ready_tx: oneshot::Sender<Result<(), String>>,
    mut stop_rx: oneshot::Receiver<()>,
    hb_handle: Arc<PMutex<Option<HeartbeatPayload>>>,
    err_handle: Arc<PMutex<Option<String>>>,
    inner_handle: Arc<PMutex<Option<RunningListener>>>,
    exit_err_handle: Arc<PMutex<Option<String>>>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut ready_tx = Some(ready_tx);

        loop {
            tokio::select! {
                // Bias the stop signal so a flood of stderr lines
                // can't starve it.
                biased;

                _ = &mut stop_rx => {
                    #[cfg(unix)]
                    {
                        if let Some(pid) = child.id() {
                            // SAFETY: pid from the live child we own.
                            unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM); }
                        }
                    }
                    // Give the listener LISTENER_STOP_GRACE_SECS to
                    // exit cleanly; if it's still running after, the
                    // wait branch below will pick up the kill.
                    let kill_after = tokio::time::sleep(
                        Duration::from_secs(LISTENER_STOP_GRACE_SECS),
                    );
                    tokio::pin!(kill_after);
                    // Continue the loop so we keep draining stderr
                    // (heartbeats may still come through during
                    // graceful shutdown). The grace timer is
                    // checked in the next select! arm.
                    tokio::select! {
                        _ = &mut kill_after => {
                            let _ = child.kill().await;
                        }
                        s = child.wait() => {
                            handle_exit(s, &exit_err_handle);
                            break;
                        }
                    }
                    // After grace timeout, ensure exit observed.
                    if let Ok(s) = child.wait().await {
                        handle_exit(Ok(s), &exit_err_handle);
                    }
                    break;
                }

                line = reader.next_line() => {
                    match line {
                        Ok(Some(text)) => {
                            process_stderr_line(
                                &text,
                                &hb_handle,
                                &err_handle,
                                &mut ready_tx,
                            );
                        }
                        Ok(None) | Err(_) => {
                            // Stream closed — child has exited or is
                            // about to. Loop will pick it up via
                            // child.wait().
                        }
                    }
                }

                exit = child.wait() => {
                    handle_exit(exit, &exit_err_handle);
                    if let Some(tx) = ready_tx.take() {
                        // Surface the last `[slack-listen]` stderr line in
                        // the connect failure so the user immediately sees
                        // the real cause (invalid_auth / missing scope /
                        // typo'd token) instead of a bare "check stderr"
                        // that asks them to dig into the supervisor logs.
                        let last = err_handle
                            .lock()
                            .clone()
                            .unwrap_or_else(|| "no stderr captured".to_string());
                        let _ = tx.send(Err(format!(
                            "listener exited before reporting ready — {}",
                            last
                        )));
                    }
                    break;
                }
            }
        }

        // Belt-and-suspenders kill in case any path above didn't
        // observe the exit (e.g. select! fall-through after a
        // closed stderr stream).
        let _ = child.kill().await;

        // Clear inner so status() flips to stopped. We don't take
        // last_error/heartbeat with us — exit_err_handle is the
        // separate channel for "last error after exit".
        *inner_handle.lock() = None;
        // Mirror clear into the process-global so the intake-server
        // `/skill/slack-send-intro` route stops servicing requests
        // against a dead listener.
        set_active_bot_token(None);
    })
}

fn handle_exit(
    res: std::io::Result<std::process::ExitStatus>,
    exit_err_handle: &Arc<PMutex<Option<String>>>,
) {
    match res {
        Ok(status) if !status.success() => {
            *exit_err_handle.lock() = Some(format!("listener exited: {}", status));
        }
        Ok(_) => {
            // Clean exit (likely a graceful stop) — no error to
            // record. If `last_exit_error` was set previously,
            // leave it alone; the next start clears it.
        }
        Err(err) => {
            *exit_err_handle.lock() = Some(format!("wait on listener failed: {}", err));
        }
    }
}

fn process_stderr_line(
    line: &str,
    hb_handle: &Arc<PMutex<Option<HeartbeatPayload>>>,
    err_handle: &Arc<PMutex<Option<String>>>,
    ready_tx: &mut Option<oneshot::Sender<Result<(), String>>>,
) {
    if line.trim_start().starts_with('{') {
        if let Ok(parsed) = serde_json::from_str::<HeartbeatPayload>(line) {
            *hb_handle.lock() = Some(parsed);
            return;
        }
    }
    if line.contains("socket-mode connected") {
        if let Some(tx) = ready_tx.take() {
            let _ = tx.send(Ok(()));
        }
        eprintln!("[slack] listener: {}", line);
        return;
    }
    if line.contains("[slack-listen]") {
        *err_handle.lock() = Some(line.to_string());
    }
    eprintln!("[slack] listener: {}", line);
}

// ---------------------------------------------------------------------------
// Bundle path resolution
// ---------------------------------------------------------------------------

pub(super) fn resolve_listener_bundle<R: Runtime>(
    app: &AppHandle<R>,
    repo: &Path,
) -> Result<PathBuf, String> {
    // 1. Packaged with the .app — the canonical copy. Always
    //    matches the running app version, so a stale plugin sync
    //    (manifest hasn't pulled the newest bundle to the project
    //    yet) doesn't end up running yesterday's listener against
    //    today's intake server contract. Tauri's resolver returns
    //    a path even when the file isn't present, so we still need
    //    the .is_file() probe.
    if let Ok(in_resources) = app
        .path()
        .resolve(LISTENER_RESOURCE_REL, BaseDirectory::Resource)
    {
        if in_resources.is_file() {
            return Ok(in_resources);
        }
    }
    // 2. Synced into the project by the plugin manifest. Used in
    //    `cargo dev` (no .app to resolve out of) and as a fallback
    //    if the resource lookup fails for some reason. A custom
    //    local build at `npm run build:slack-listener` lands the
    //    bundle into the source tree, which is what the plugin
    //    manifest copies into projects.
    let in_repo = repo.join(LISTENER_REPO_REL);
    if in_repo.is_file() {
        return Ok(in_repo);
    }
    Err(format!(
        "slack listener bundle not found at app resources or in {}; \
         run `npm run build:slack-listener` and re-sync the plugin",
        in_repo.display()
    ))
}
