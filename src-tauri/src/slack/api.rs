// Slack REST helpers — auth.test, users.lookupByEmail, chat.postMessage.
//
// Just enough to connect-validate and send the one-shot intro DM.
// The websocket and event handling live in the Node listener.

use reqwest::Client as HttpClient;
use serde::Deserialize;

use super::SLACK_API_BASE;

#[derive(Deserialize)]
pub(super) struct AuthTestResp {
    pub ok: bool,
    pub error: Option<String>,
    pub team_id: Option<String>,
    pub team: Option<String>,
    pub user_id: Option<String>,
    pub user: Option<String>,
}

pub(super) async fn slack_auth_test(
    http: &HttpClient,
    bot_token: &str,
) -> Result<AuthTestResp, String> {
    let resp = http
        .post(format!("{}/auth.test", SLACK_API_BASE))
        .bearer_auth(bot_token)
        .send()
        .await
        .map_err(|e| format!("Slack auth.test request failed: {}", e))?;
    let body: AuthTestResp = resp
        .json()
        .await
        .map_err(|e| format!("Slack auth.test parse failed: {}", e))?;
    Ok(body)
}

#[derive(Deserialize)]
struct LookupByEmailResp {
    ok: bool,
    error: Option<String>,
    user: Option<LookupUser>,
}

#[derive(Deserialize)]
struct LookupUser {
    id: String,
}

pub(crate) async fn slack_lookup_user_id(
    http: &HttpClient,
    bot_token: &str,
    email: &str,
) -> Result<String, String> {
    let resp = http
        .post(format!("{}/users.lookupByEmail", SLACK_API_BASE))
        .bearer_auth(bot_token)
        .form(&[("email", email)])
        .send()
        .await
        .map_err(|e| format!("Slack users.lookupByEmail request failed: {}", e))?;
    let body: LookupByEmailResp = resp
        .json()
        .await
        .map_err(|e| format!("Slack users.lookupByEmail parse failed: {}", e))?;
    if !body.ok {
        return Err(body
            .error
            .unwrap_or_else(|| "users.lookupByEmail failed".into()));
    }
    body.user
        .map(|u| u.id)
        .ok_or_else(|| "users.lookupByEmail returned no user".into())
}

#[derive(Deserialize)]
struct PostMessageResp {
    ok: bool,
    error: Option<String>,
}

pub(crate) async fn slack_post_message(
    http: &HttpClient,
    bot_token: &str,
    channel: &str,
    text: &str,
) -> Result<(), String> {
    let resp = http
        .post(format!("{}/chat.postMessage", SLACK_API_BASE))
        .bearer_auth(bot_token)
        .json(&serde_json::json!({ "channel": channel, "text": text }))
        .send()
        .await
        .map_err(|e| format!("Slack chat.postMessage request failed: {}", e))?;
    let body: PostMessageResp = resp
        .json()
        .await
        .map_err(|e| format!("Slack chat.postMessage parse failed: {}", e))?;
    if !body.ok {
        return Err(body
            .error
            .unwrap_or_else(|| "chat.postMessage failed".into()));
    }
    Ok(())
}
