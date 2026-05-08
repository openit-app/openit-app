// Tunnel module — exposes the localhost intake server to the public
// internet via Cloudflare's free quick-tunnel feature (`cloudflared`).
//
// Strategy: shell out to the `cloudflared` binary. The command
// `cloudflared tunnel --url http://127.0.0.1:<port>` requires no
// account or config — it spins up an ephemeral tunnel and prints a
// `https://<random>.trycloudflare.com` URL on stderr. The tunnel
// lives exactly as long as the process — laptop sleep / app close →
// URL dies. That ephemerality is intentional (cloud-hosted is the
// upgrade story), so we make no attempt to keep it alive across
// reconnects.
//
// Two APIs:
// - Standalone functions (`start_tunnel_process`, `stop_tunnel_state`)
//   for use from the intake Axum server's HTTP routes.
// - Tauri commands (`tunnel_start`, `tunnel_stop`, `tunnel_url`) kept
//   for backward compat with the desktop frontend.

use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use parking_lot::Mutex;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command as TokioCommand};
use tokio::sync::{oneshot, Mutex as TokioMutex};
use tokio::task::JoinHandle;
use tokio::time::timeout;

// Shared with `intake.rs` so its CSRF / origin guard can accept the
// currently-active tunnel host (e.g. `abc123.trycloudflare.com`) in
// addition to localhost.
static ACTIVE_TUNNEL_HOST: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn host_slot() -> &'static Mutex<Option<String>> {
    ACTIVE_TUNNEL_HOST.get_or_init(|| Mutex::new(None))
}

pub(crate) fn current_tunnel_host() -> Option<String> {
    host_slot().lock().clone()
}

fn set_current_tunnel_host(host: Option<String>) {
    *host_slot().lock() = host;
}

/// A running cloudflared tunnel. Drop kills the child process.
pub(crate) struct RunningTunnel {
    pub url: String,
    _child: Child,
    stdout_task: Option<JoinHandle<()>>,
    stderr_task: Option<JoinHandle<()>>,
}

/// How long to wait for cloudflared to print a URL after spawn.
/// Quick tunnels typically print within 2–5s; 30s covers slow links.
const URL_WAIT_SECS: u64 = 30;

// ---------------------------------------------------------------------------
// Standalone API — used by the intake server's /share/* routes.
// ---------------------------------------------------------------------------

/// Spawn `cloudflared tunnel --url http://127.0.0.1:<port>` and wait
/// for the public URL. Returns the running tunnel on success.
pub(crate) async fn start_tunnel_process(port: u16) -> Result<RunningTunnel, String> {
    let mut child = TokioCommand::new("cloudflared")
        .args([
            "tunnel",
            "--url",
            &format!("http://127.0.0.1:{}", port),
            "--no-autoupdate",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "cloudflared not found. Install it with: brew install cloudflared".to_string()
            } else {
                format!("spawn cloudflared failed: {}", e)
            }
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "child stdout missing".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "child stderr missing".to_string())?;

    let (url_tx, url_rx) = oneshot::channel::<String>();
    let url_tx = Arc::new(Mutex::new(Some(url_tx)));

    let stdout_task = spawn_url_scanner("out", stdout, url_tx.clone());
    let stderr_task = spawn_url_scanner("err", stderr, url_tx.clone());

    let url = match timeout(Duration::from_secs(URL_WAIT_SECS), url_rx).await {
        Ok(Ok(u)) => u,
        Ok(Err(_)) => {
            stdout_task.abort();
            stderr_task.abort();
            return Err(
                "cloudflared exited before printing tunnel URL — check your internet connection"
                    .into(),
            );
        }
        Err(_) => {
            stdout_task.abort();
            stderr_task.abort();
            return Err(format!(
                "timed out after {}s waiting for tunnel URL",
                URL_WAIT_SECS
            ));
        }
    };

    // Publish the host to the shared CORS allowlist.
    if let Ok(parsed) = url::Url::parse(&url) {
        if let Some(host) = parsed.host_str() {
            set_current_tunnel_host(Some(host.to_string()));
        }
    }

    Ok(RunningTunnel {
        url,
        _child: child,
        stdout_task: Some(stdout_task),
        stderr_task: Some(stderr_task),
    })
}

/// Cleanly tear down a running tunnel — aborts reader tasks and lets
/// kill_on_drop handle the cloudflared process.
pub(crate) fn stop_running_tunnel(mut tunnel: RunningTunnel) {
    if let Some(h) = tunnel.stdout_task.take() {
        h.abort();
    }
    if let Some(h) = tunnel.stderr_task.take() {
        h.abort();
    }
    // Dropping `_child` triggers kill_on_drop.
    set_current_tunnel_host(None);
}

// ---------------------------------------------------------------------------
// Tauri commands — thin wrappers for backward compat.
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct TunnelState {
    inner: Mutex<Option<RunningTunnel>>,
    cmd_lock: TokioMutex<()>,
}

#[tauri::command]
pub async fn tunnel_start(
    state: tauri::State<'_, TunnelState>,
    local_url: String,
) -> Result<String, String> {
    let port = parse_port(&local_url)?;

    let _cmd_guard = state.cmd_lock.lock().await;
    stop_inner(&state);

    let tunnel = start_tunnel_process(port).await?;
    let url = tunnel.url.clone();

    let mut guard = state.inner.lock();
    *guard = Some(tunnel);

    Ok(url)
}

#[tauri::command]
pub async fn tunnel_stop(state: tauri::State<'_, TunnelState>) -> Result<(), String> {
    let _cmd_guard = state.cmd_lock.lock().await;
    stop_inner(&state);
    Ok(())
}

#[tauri::command]
pub fn tunnel_url(state: tauri::State<'_, TunnelState>) -> Option<String> {
    let guard = state.inner.lock();
    guard.as_ref().map(|t| t.url.clone())
}

fn stop_inner(state: &TunnelState) {
    let running = {
        let mut guard = state.inner.lock();
        guard.take()
    };
    if let Some(tunnel) = running {
        stop_running_tunnel(tunnel);
    }
}

// ---------------------------------------------------------------------------
// URL scanner — shared by both APIs.
// ---------------------------------------------------------------------------

fn spawn_url_scanner<R>(
    label: &'static str,
    reader: R,
    url_tx: Arc<Mutex<Option<oneshot::Sender<String>>>>,
) -> JoinHandle<()>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            eprintln!("[tunnel/{}] {}", label, line);
            if let Some(found) = extract_cf_url(&line) {
                if let Some(tx) = url_tx.lock().take() {
                    let _ = tx.send(found);
                }
            }
        }
    })
}

/// Find the first `https://<sub>.trycloudflare.com` token in a line.
fn extract_cf_url(line: &str) -> Option<String> {
    let mut search_from = 0;
    while let Some(rel) = line[search_from..].find("https://") {
        let abs = search_from + rel;
        let tail = &line[abs..];
        let end = tail
            .char_indices()
            .find(|(_, c)| !is_url_host_char(*c))
            .map(|(i, _)| i)
            .unwrap_or(tail.len());
        let candidate = &tail[..end];
        if candidate.contains(".trycloudflare.com") {
            return Some(candidate.to_string());
        }
        search_from = abs + "https://".len();
    }
    None
}

fn is_url_host_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':' || c == '/'
}

fn parse_port(local_url: &str) -> Result<u16, String> {
    let parsed = url::Url::parse(local_url).map_err(|e| format!("bad local_url: {}", e))?;
    parsed
        .port()
        .ok_or_else(|| format!("local_url missing port: {}", local_url))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_cf_url_from_log_line() {
        let line =
            "2024-01-15T10:00:01Z INF +----------------------------------------------------------+";
        assert_eq!(extract_cf_url(line), None);
        let line2 =
            "2024-01-15T10:00:01Z INF |  https://random-words-here.trycloudflare.com              |";
        assert_eq!(
            extract_cf_url(line2).as_deref(),
            Some("https://random-words-here.trycloudflare.com"),
        );
    }

    #[test]
    fn extracts_url_with_trailing_whitespace() {
        let line = "INF https://abc-def-ghi.trycloudflare.com  ";
        assert_eq!(
            extract_cf_url(line).as_deref(),
            Some("https://abc-def-ghi.trycloudflare.com"),
        );
    }

    #[test]
    fn ignores_non_cf_https() {
        assert_eq!(extract_cf_url("see https://example.com for docs"), None);
    }

    #[test]
    fn finds_cf_url_after_unrelated_https() {
        let line =
            "docs at https://developers.cloudflare.com — your URL: https://abc123.trycloudflare.com";
        assert_eq!(
            extract_cf_url(line).as_deref(),
            Some("https://abc123.trycloudflare.com"),
        );
    }

    #[test]
    fn parses_port_from_intake_url() {
        assert_eq!(parse_port("http://127.0.0.1:54123").unwrap(), 54123);
    }
}
