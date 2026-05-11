// Slack listener supervisor.
//
// Pairs with `scripts/openit-plugin/scripts/slack-listen.src.mjs`
// (bundled to `slack-listen.bundle.cjs` by `npm run build:slack-listener`).
// Owns the listener's lifecycle from the Tauri side: validates
// tokens against Slack, persists them in keychain + a non-secret
// pointer file, spawns the bundled Node process with the right env
// vars, parses heartbeat lines off stderr so the UI can show
// "Slack: connected" with sessions / ticket counts.
//
// Design choices:
//
//  - Node listener, not in-process Rust. The Slack SDK ecosystem in
//    Node is the canonical surface; bundled-CJS keeps the listener
//    drop-in for users who run `claude` in a terminal.
//
//  - Supervisor knows nothing Slack-protocol-specific beyond the
//    handful of REST calls used for connect-validation and the
//    one-shot intro DM (auth.test, users.lookupByEmail,
//    chat.postMessage). The websocket lives in the Node process.
//
//  - Heartbeats are JSON lines on stderr. The supervisor parses
//    them into `LiveStatus` so the UI doesn't need to know the
//    listener's protocol.

mod api;
mod config;
mod listener;

use parking_lot::Mutex as PMutex;
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Runtime};
use tokio::process::Command as TokioCommand;
use tokio::sync::{oneshot, Mutex as TokioMutex};
use tokio::task::JoinHandle;
use tokio::time::timeout;

pub(crate) use api::{slack_lookup_user_id, slack_post_message};
pub use config::SlackConfig;
use config::{
    delete_slack_config, keychain_delete_blocking, keychain_get_blocking, keychain_set_blocking,
    read_slack_config, write_slack_config,
};

// ---------------------------------------------------------------------------
// Constants — keychain slots, file paths, env-var names, timeouts.
// ---------------------------------------------------------------------------

/// Keychain service id matches the rest of the app
/// (`keychain.rs::SERVICE`). Slot names below are scoped per
/// orgId so two projects with different orgs don't share
/// tokens. Empty `org_id` (cloud not connected) maps to a
/// `local` qualifier so the slot is still well-formed.
const KEYCHAIN_SERVICE: &str = "ai.pinkfish.openit";
const KC_SLOT_BOT_PREFIX: &str = "slack:bot-token:";
const KC_SLOT_APP_PREFIX: &str = "slack:app-token:";

/// Non-secret pointer file written into the project. Contains
/// workspace metadata so the FE knows what's connected without
/// reading from keychain.
const SLACK_CONFIG_REL: &str = ".openit/slack.json";

/// Where the bundled listener artifact lands once `entity_write_file`
/// has fanned out the plugin manifest. The supervisor first looks
/// here; if missing (e.g. the user nuked .claude/), falls back to
/// the resource baked into the .app bundle.
const LISTENER_REPO_REL: &str = ".claude/scripts/slack-listen.bundle.cjs";
const LISTENER_RESOURCE_REL: &str = "openit-plugin/scripts/slack-listen.bundle.cjs";

const SLACK_API_BASE: &str = "https://slack.com/api";
const HTTP_TIMEOUT_SECS: u64 = 15;
const LISTENER_READY_TIMEOUT_SECS: u64 = 10;
const LISTENER_STOP_GRACE_SECS: u64 = 5;

/// Process-global mirror of the active listener's bot token. The
/// intake server (`intake.rs`) reads this to service the
/// `/skill/slack-send-intro` route without having to thread an
/// `AppHandle` (and therefore Tauri-managed `SlackSupervisorState`)
/// through the Axum router. Updated by `slack_listener_start` on
/// successful bring-up and cleared by `stop_inner` / supervisor exit.
static ACTIVE_BOT_TOKEN: OnceLock<Arc<PMutex<Option<String>>>> = OnceLock::new();

fn active_bot_token_slot() -> &'static Arc<PMutex<Option<String>>> {
    ACTIVE_BOT_TOKEN.get_or_init(|| Arc::new(PMutex::new(None)))
}

/// Public read-only accessor for the active listener's bot token.
/// Returns `None` when no listener is running. Cheap (clones a
/// short string under a parking_lot mutex).
pub fn current_bot_token() -> Option<String> {
    active_bot_token_slot().lock().clone()
}

fn set_active_bot_token(token: Option<String>) {
    *active_bot_token_slot().lock() = token;
}

fn bot_token_slot(org_id: &str) -> String {
    format!(
        "{}{}",
        KC_SLOT_BOT_PREFIX,
        if org_id.is_empty() { "local" } else { org_id }
    )
}

fn app_token_slot(org_id: &str) -> String {
    format!(
        "{}{}",
        KC_SLOT_APP_PREFIX,
        if org_id.is_empty() { "local" } else { org_id }
    )
}

// ---------------------------------------------------------------------------
// Live supervisor state
// ---------------------------------------------------------------------------

#[derive(Default, Clone, Serialize, Deserialize)]
pub struct HeartbeatPayload {
    pub ts: String,
    pub sessions: u32,
    pub open_tickets: u32,
    pub queue_depth: u32,
    pub workers: u32,
}

#[derive(Default)]
pub struct SlackSupervisorState {
    /// `Arc` so the supervisor task spawned at start time can clear
    /// us back to `None` when the listener exits — planned (via
    /// `stop_tx`) or unexpected (child crash). Without this the
    /// supervisor task would have no way to flip status; the
    /// header pill would stay green after a crash.
    inner: Arc<PMutex<Option<RunningListener>>>,
    /// Captures the listener's exit status / last error line when
    /// the child exits unexpectedly. Read by `slack_listener_status`
    /// only when `inner` is None — so the FE can show "Slack:
    /// stopped (reason)" rather than just "stopped". Cleared on the
    /// next successful start.
    last_exit_error: Arc<PMutex<Option<String>>>,
    /// Async-aware lock around the whole start/stop lifecycle so a
    /// concurrent `slack_listener_start` can't race with a `_stop`.
    /// Same shape `IntakeState` uses.
    cmd_lock: TokioMutex<()>,
}

pub(crate) struct RunningListener {
    pub workspace_id: String,
    pub workspace_name: String,
    pub bot_user_id: String,
    pub bot_name: String,
    /// Bot token cached here so `slack_listener_send_intro` doesn't
    /// have to round-trip to the keychain (and so it works even if
    /// the keychain hasn't been touched in this session).
    pub bot_token: String,
    pub last_heartbeat: Arc<PMutex<Option<HeartbeatPayload>>>,
    /// Live error line from the listener's stderr (most recent
    /// `[slack-listen]` diagnostic). Distinct from
    /// `SlackSupervisorState.last_exit_error`, which only fills
    /// when the process *exits*.
    pub last_error: Arc<PMutex<Option<String>>>,
    /// Send `()` to ask the supervisor task to stop the child
    /// gracefully (SIGTERM, 5s grace, SIGKILL). Taken (Some→None)
    /// during stop so the second stop call is a no-op.
    pub stop_tx: Option<oneshot::Sender<()>>,
    /// Single task that owns the `Child` and its stderr stream:
    /// drains heartbeat / error lines, observes either the stop
    /// signal or an unexpected child exit, kills if needed, then
    /// clears `state.inner` and writes `last_exit_error`. We await
    /// it on stop so the cleanup is observable from the caller.
    pub supervisor_task: Option<JoinHandle<()>>,
}

#[derive(Serialize)]
pub struct SlackStatus {
    pub running: bool,
    pub workspace_id: Option<String>,
    pub workspace_name: Option<String>,
    pub bot_user_id: Option<String>,
    pub bot_name: Option<String>,
    pub last_heartbeat: Option<HeartbeatPayload>,
    pub last_error: Option<String>,
}

// ---------------------------------------------------------------------------
// Tauri commands — connect / disconnect / start / stop / status / intro.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct SlackConnectMeta {
    pub workspace_id: String,
    pub workspace_name: String,
    pub bot_user_id: String,
    pub bot_name: String,
    pub connected_at: String,
}

/// Validate a bot token against Slack without storing anything.
/// Used by the canvas's "paste-as-you-go" flow: when the admin
/// pastes the `xoxb-` token at the install step, we want to
/// confirm it works (right away, while they still have the Slack
/// tab open) before they move on to generate the app-level token.
/// The returned metadata also lets the canvas show "Validated for
/// Acme as @OpenIT" inline so they know the paste landed.
///
/// Storage happens later in `slack_connect` once both tokens are
/// in hand. Bot token is held in React state between the two
/// calls — never written to disk except via Keychain.
#[tauri::command]
pub async fn slack_validate_bot_token(bot_token: String) -> Result<SlackConnectMeta, String> {
    let bot_token = bot_token.trim();
    if !bot_token.starts_with("xoxb-") {
        return Err("bot token must start with 'xoxb-'".into());
    }
    let http = HttpClient::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("http client: {}", e))?;
    let auth = api::slack_auth_test(&http, bot_token).await?;
    if !auth.ok {
        return Err(auth
            .error
            .unwrap_or_else(|| "auth.test failed (no error message)".into()));
    }
    Ok(SlackConnectMeta {
        workspace_id: auth.team_id.ok_or("auth.test missing team_id")?,
        workspace_name: auth.team.unwrap_or_else(|| "<unknown>".to_string()),
        bot_user_id: auth.user_id.ok_or("auth.test missing user_id")?,
        bot_name: auth.user.unwrap_or_else(|| "OpenIT".to_string()),
        connected_at: now_iso(),
    })
}

/// Validate the supplied bot token against Slack, persist both
/// tokens to keychain, and write the non-secret `.openit/slack.json`
/// pointer file. Returns the workspace metadata so the FE can show
/// "Connected to Acme as @OpenIT" without a follow-up call.
///
/// We deliberately do *not* validate the app token here: Slack only
/// accepts `xapp-` tokens against `apps.connections.open`, which
/// opens a websocket — too heavyweight for a connect-time probe.
/// A bad app token surfaces immediately at listener-start time when
/// the SocketModeClient fails to handshake.
#[tauri::command]
pub async fn slack_connect(
    repo: String,
    bot_token: String,
    app_token: String,
    org_id: String,
) -> Result<SlackConnectMeta, String> {
    let repo_path = PathBuf::from(&repo);
    if !repo_path.is_dir() {
        return Err(format!("slack_connect: not a directory: {}", repo));
    }
    let bot_token = bot_token.trim().to_string();
    let app_token = app_token.trim().to_string();
    if !bot_token.starts_with("xoxb-") {
        return Err("bot token must start with 'xoxb-'".into());
    }
    if !app_token.starts_with("xapp-") {
        return Err("app token must start with 'xapp-'".into());
    }

    let http = HttpClient::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("http client: {}", e))?;
    let auth = api::slack_auth_test(&http, &bot_token).await?;
    if !auth.ok {
        return Err(auth
            .error
            .unwrap_or_else(|| "auth.test failed (no error message)".into()));
    }
    let workspace_id = auth.team_id.ok_or("auth.test missing team_id")?;
    let workspace_name = auth.team.unwrap_or_else(|| "<unknown>".to_string());
    let bot_user_id = auth.user_id.ok_or("auth.test missing user_id")?;
    let bot_name = auth.user.unwrap_or_else(|| "OpenIT".to_string());

    // Write keychain on a blocking task — the keyring crate is
    // blocking. Doing this on the async runtime would stall it.
    let bot_slot = bot_token_slot(&org_id);
    let app_slot = app_token_slot(&org_id);
    let bot_for_kc = bot_token.clone();
    let app_for_kc = app_token.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        keychain_set_blocking(&bot_slot, &bot_for_kc)?;
        keychain_set_blocking(&app_slot, &app_for_kc)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("keychain task join: {}", e))??;

    let connected_at = now_iso();
    let cfg = SlackConfig {
        workspace_id: workspace_id.clone(),
        workspace_name: workspace_name.clone(),
        bot_user_id: bot_user_id.clone(),
        bot_name: bot_name.clone(),
        connected_at: connected_at.clone(),
        allowed_domains: Vec::new(),
    };
    write_slack_config(&repo_path, &cfg).await?;

    Ok(SlackConnectMeta {
        workspace_id,
        workspace_name,
        bot_user_id,
        bot_name,
        connected_at,
    })
}

/// Tear down: stop the listener if running, scrub keychain entries
/// for this org, delete the pointer file. Idempotent — safe to call
/// when nothing's connected.
#[tauri::command]
pub async fn slack_disconnect(
    state: tauri::State<'_, SlackSupervisorState>,
    repo: String,
    org_id: String,
) -> Result<(), String> {
    let _cmd_guard = state.cmd_lock.lock().await;
    stop_inner(&state).await;

    let bot_slot = bot_token_slot(&org_id);
    let app_slot = app_token_slot(&org_id);
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        keychain_delete_blocking(&bot_slot)?;
        keychain_delete_blocking(&app_slot)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("keychain task join: {}", e))??;

    let repo_path = PathBuf::from(&repo);
    delete_slack_config(&repo_path).await?;
    Ok(())
}

/// Read the public-facing config file (no secrets). FE uses this on
/// project bootstrap to decide whether to auto-start the listener.
#[tauri::command]
pub async fn slack_config_read(repo: String) -> Result<Option<SlackConfig>, String> {
    read_slack_config(&PathBuf::from(repo)).await
}

#[tauri::command]
pub async fn slack_listener_start<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, SlackSupervisorState>,
    repo: String,
    intake_url: String,
    org_id: String,
) -> Result<(), String> {
    let repo_path = PathBuf::from(&repo);
    let _cmd_guard = state.cmd_lock.lock().await;

    // Idempotent: if already running, no-op.
    if state.inner.lock().is_some() {
        return Ok(());
    }

    let cfg = read_slack_config(&repo_path)
        .await?
        .ok_or_else(|| "slack not configured for this project".to_string())?;

    // Pull tokens from keychain on a blocking task.
    let bot_slot = bot_token_slot(&org_id);
    let app_slot = app_token_slot(&org_id);
    let (bot_token, app_token) = tokio::task::spawn_blocking(
        move || -> Result<(Option<String>, Option<String>), String> {
            Ok((
                keychain_get_blocking(&bot_slot)?,
                keychain_get_blocking(&app_slot)?,
            ))
        },
    )
    .await
    .map_err(|e| format!("keychain task join: {}", e))??;
    let bot_token = bot_token.ok_or("bot token missing from keychain — reconnect Slack")?;
    let app_token = app_token.ok_or("app token missing from keychain — reconnect Slack")?;

    let bundle_path = listener::resolve_listener_bundle(&app, &repo_path)?;

    // Clear stale exit error from any prior crash before we
    // attempt to come back up — otherwise a successful restart
    // would still surface the old error in status.
    *state.last_exit_error.lock() = None;

    let mut allowed_domains_env = String::new();
    if !cfg.allowed_domains.is_empty() {
        allowed_domains_env = cfg.allowed_domains.join(",");
    }

    let mut cmd = TokioCommand::new("node");
    cmd.arg(&bundle_path)
        .env("OPENIT_REPO", &repo)
        .env("OPENIT_INTAKE_URL", &intake_url)
        .env("OPENIT_SLACK_BOT_TOKEN", &bot_token)
        .env("OPENIT_SLACK_APP_TOKEN", &app_token)
        .env("OPENIT_SLACK_WORKSPACE_ID", &cfg.workspace_id)
        .env("OPENIT_SLACK_BOT_USER_ID", &cfg.bot_user_id)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if !allowed_domains_env.is_empty() {
        cmd.env("OPENIT_SLACK_ALLOWED_DOMAINS", &allowed_domains_env);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn node: {} — {}", bundle_path.display(), e))?;

    let stderr = child
        .stderr
        .take()
        .ok_or("listener stderr unavailable after spawn")?;

    let last_heartbeat: Arc<PMutex<Option<HeartbeatPayload>>> = Arc::new(PMutex::new(None));
    let last_error: Arc<PMutex<Option<String>>> = Arc::new(PMutex::new(None));
    let (ready_tx, ready_rx) = oneshot::channel::<Result<(), String>>();
    let (stop_tx, stop_rx) = oneshot::channel::<()>();

    let supervisor_task = listener::spawn_supervisor_task(
        child,
        stderr,
        ready_tx,
        stop_rx,
        last_heartbeat.clone(),
        last_error.clone(),
        state.inner.clone(),
        state.last_exit_error.clone(),
    );

    let ready = match timeout(Duration::from_secs(LISTENER_READY_TIMEOUT_SECS), ready_rx).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(msg))) => Err(msg),
        Ok(Err(_)) => Err("listener supervisor task dropped before ready".to_string()),
        Err(_) => Err(format!(
            "listener did not report ready within {}s",
            LISTENER_READY_TIMEOUT_SECS
        )),
    };
    if let Err(msg) = ready {
        // Failed to come up — supervisor task is still running but
        // either child has exited or is hung. Abort the task; its
        // Drop will kill the child via kill_on_drop.
        supervisor_task.abort();
        // Best-effort propagate the failure into last_exit_error so
        // a subsequent status() call surfaces it without needing
        // the FE to plumb the error string through.
        *state.last_exit_error.lock() = Some(msg.clone());
        return Err(msg);
    }

    let running = RunningListener {
        workspace_id: cfg.workspace_id,
        workspace_name: cfg.workspace_name,
        bot_user_id: cfg.bot_user_id,
        bot_name: cfg.bot_name,
        bot_token,
        last_heartbeat,
        last_error,
        stop_tx: Some(stop_tx),
        supervisor_task: Some(supervisor_task),
    };

    // Tiny race window: between the supervisor task signaling ready
    // and us reaching this line, the child could have exited (bad
    // app token caught by Slack on the first websocket frame, OOM,
    // process killed by external tool, etc.). The supervisor task
    // would have observed the exit and tried to clear inner — which
    // was None at the time, so the clear was a no-op. If we now
    // store Some(...) without checking, status() returns running:
    // true forever for a corpse.
    //
    // Detect this by checking is_finished() on the supervisor task
    // immediately AFTER storing (we want the store visible first so
    // any concurrent supervisor-task-tail-clear correctly clobbers
    // it). If the task already finished, clear inner ourselves and
    // return the captured exit error so the FE sees the failure
    // synchronously instead of via the next status poll.
    let already_dead = running
        .supervisor_task
        .as_ref()
        .map(|t| t.is_finished())
        .unwrap_or(true);
    let bot_token_for_global = running.bot_token.clone();
    *state.inner.lock() = Some(running);
    if already_dead {
        *state.inner.lock() = None;
        set_active_bot_token(None);
        let exit_err = state
            .last_exit_error
            .lock()
            .clone()
            .unwrap_or_else(|| "listener exited immediately after reporting ready".into());
        return Err(exit_err);
    }
    set_active_bot_token(Some(bot_token_for_global));
    Ok(())
}

#[tauri::command]
pub async fn slack_listener_stop(
    state: tauri::State<'_, SlackSupervisorState>,
) -> Result<(), String> {
    let _cmd_guard = state.cmd_lock.lock().await;
    stop_inner(&state).await;
    Ok(())
}

async fn stop_inner(state: &tauri::State<'_, SlackSupervisorState>) {
    // Pull the stop signal + supervisor handle out under the
    // lock, but DO NOT clear `state.inner` here — the supervisor
    // task is the single source of truth for that. It clears
    // inner once the child is observed to have exited, which
    // makes "stopped" visible to `status()` only when it's
    // actually true.
    let (stop_tx, supervisor_task) = {
        let mut guard = state.inner.lock();
        match guard.as_mut() {
            Some(r) => (r.stop_tx.take(), r.supervisor_task.take()),
            None => return,
        }
    };
    if let Some(tx) = stop_tx {
        let _ = tx.send(());
    }
    if let Some(task) = supervisor_task {
        let _ = task.await;
    }
}

#[tauri::command]
pub fn slack_listener_status(state: tauri::State<'_, SlackSupervisorState>) -> SlackStatus {
    let guard = state.inner.lock();
    match guard.as_ref() {
        None => SlackStatus {
            running: false,
            workspace_id: None,
            workspace_name: None,
            bot_user_id: None,
            bot_name: None,
            last_heartbeat: None,
            // Surface the captured exit error so the FE can show
            // "Slack: stopped (listener exited: signal 9)" instead
            // of just "stopped". Cleared on next successful start.
            last_error: state.last_exit_error.lock().clone(),
        },
        Some(r) => SlackStatus {
            running: true,
            workspace_id: Some(r.workspace_id.clone()),
            workspace_name: Some(r.workspace_name.clone()),
            bot_user_id: Some(r.bot_user_id.clone()),
            bot_name: Some(r.bot_name.clone()),
            last_heartbeat: r.last_heartbeat.lock().clone(),
            last_error: r.last_error.lock().clone(),
        },
    }
}

/// One-shot DM used by the connect-slack skill's verify step. Looks
/// up the target's Slack user id by email, opens the DM channel
/// implicitly via chat.postMessage's `channel: <user_id>` form, and
/// posts the intro text. Requires the listener to be running so we
/// have the bot token in hand.
#[tauri::command]
pub async fn slack_listener_send_intro(
    state: tauri::State<'_, SlackSupervisorState>,
    target_email: String,
    text: String,
) -> Result<(), String> {
    let bot_token = {
        let guard = state.inner.lock();
        guard
            .as_ref()
            .map(|r| r.bot_token.clone())
            .ok_or("listener not running — connect Slack first")?
    };
    let http = HttpClient::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("http client: {}", e))?;
    let user_id = api::slack_lookup_user_id(&http, &bot_token, target_email.trim()).await?;
    api::slack_post_message(&http, &bot_token, &user_id, text.trim()).await
}

// ---------------------------------------------------------------------------
// Tiny date helper — same algorithm `intake.rs::now_iso` uses;
// duplicated locally so this module stays standalone.
// ---------------------------------------------------------------------------

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = unix_to_ymdhms(secs);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, h, mi, s)
}

fn unix_to_ymdhms(secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86_400);
    let mut s_of_day = secs.rem_euclid(86_400) as u32;
    let h = s_of_day / 3600;
    s_of_day -= h * 3600;
    let mi = s_of_day / 60;
    let s = s_of_day - mi * 60;

    // Howard Hinnant's date algorithm.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i32) + (era as i32) * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d, h, mi, s)
}
