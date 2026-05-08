// Agent loading, smart routing, and prompt construction for the chat
// intake server. Extracted from the original monolithic intake.rs.

use super::ChatMessage;
use std::path::Path;

/// Load any agent by name. V3 agents are single `.md` files at
/// `agents/<name>.md`. Falls back to V2 folder layout and V1 flat
/// JSON for backwards compat. Returns (instructions, model).
pub(super) async fn load_agent(repo: &Path, name: &str) -> (String, String) {
    // V3: single .md file
    let md_path = repo.join("agents").join(format!("{name}.md"));
    if md_path.exists() {
        let instructions = tokio::fs::read_to_string(&md_path)
            .await
            .unwrap_or_else(|_| "You are a helpdesk agent.".to_string());
        return (instructions, "sonnet".to_string());
    }

    // V2: folder layout with JSON + .md siblings
    let folder = repo.join("agents").join(name);
    let folder_json = folder.join(format!("{name}.json"));
    if folder_json.exists() {
        let raw = tokio::fs::read_to_string(&folder_json).await.ok();
        let parsed: Option<serde_json::Value> =
            raw.as_deref().and_then(|s| serde_json::from_str(s).ok());
        let model = parsed
            .as_ref()
            .and_then(|v| v.get("selectedModel"))
            .and_then(|v| v.as_str())
            .unwrap_or("sonnet")
            .to_string();
        let common = tokio::fs::read_to_string(folder.join("common.md"))
            .await
            .unwrap_or_default();
        let local = tokio::fs::read_to_string(folder.join("local.md"))
            .await
            .unwrap_or_default();
        let assembled = match (common.trim().is_empty(), local.trim().is_empty()) {
            (true, true) => String::new(),
            (true, false) => local.trim().to_string(),
            (false, true) => common.trim().to_string(),
            (false, false) => format!("{}\n\n{}", common.trim(), local.trim()),
        };
        let instructions = if assembled.is_empty() {
            "You are a helpdesk agent.".to_string()
        } else {
            assembled
        };
        return (instructions, model);
    }

    // V1: flat JSON with instructions field
    let flat = repo.join("agents").join(format!("{name}.json"));
    if let Ok(raw) = tokio::fs::read_to_string(&flat).await {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
            let model = parsed
                .get("selectedModel")
                .and_then(|v| v.as_str())
                .unwrap_or("sonnet")
                .to_string();
            let instructions = parsed
                .get("instructions")
                .and_then(|v| v.as_str())
                .unwrap_or("You are a helpdesk agent.")
                .to_string();
            return (instructions, model);
        }
    }

    (
        "You are a helpdesk agent.".to_string(),
        "sonnet".to_string(),
    )
}

/// List available agents by scanning `agents/*.md`. Returns a vec of
/// (name, first_line_description) pairs.
pub(super) async fn list_agents(repo: &Path) -> Vec<(String, String)> {
    let dir = repo.join("agents");
    eprintln!("[intake/router] scanning agents at: {}", dir.display());
    let mut agents = Vec::new();
    let Ok(mut entries) = tokio::fs::read_dir(&dir).await else {
        eprintln!("[intake/router] failed to read agents dir");
        return agents;
    };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".md") {
            continue;
        }
        let agent_name = name.trim_end_matches(".md").to_string();
        let first_line = tokio::fs::read_to_string(entry.path())
            .await
            .unwrap_or_default()
            .lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("")
            .chars()
            .take(120)
            .collect::<String>();
        agents.push((agent_name.clone(), first_line.clone()));
        eprintln!(
            "[intake/router] found agent: {agent_name} — {}",
            first_line.chars().take(60).collect::<String>()
        );
    }
    eprintln!("[intake/router] total agents found: {}", agents.len());
    agents
}

/// Smart router: classify which agent should handle a message.
/// Scores each agent by keyword overlap between the user's message
/// and the agent's description (first line of its .md file). No LLM
/// call — instant, zero latency, zero cost, always works.
/// Falls back to "triage" when scores are tied or no agents exist.
pub(super) async fn classify_agent(repo: &Path, message: &str, _claude_path: &Path) -> String {
    let agents = list_agents(repo).await;
    if agents.len() <= 1 {
        return agents
            .first()
            .map(|(n, _)| n.clone())
            .unwrap_or_else(|| "triage".to_string());
    }

    let msg_lower = message.to_lowercase();
    let msg_words: std::collections::HashSet<&str> = msg_lower.split_whitespace().collect();

    let mut best_name = "triage".to_string();
    let mut best_score: usize = 0;

    for (name, description) in &agents {
        let desc_lower = description.to_lowercase();
        let desc_words: std::collections::HashSet<&str> = desc_lower.split_whitespace().collect();

        // Score = number of message words that appear in the agent description
        let overlap = msg_words.intersection(&desc_words).count();

        // Bonus: if the agent name itself appears in the message, strong signal
        let name_bonus = if msg_lower.contains(&name.to_lowercase()) {
            5
        } else {
            0
        };

        let total = overlap + name_bonus;
        eprintln!("[intake/router] agent '{name}' score={total} (overlap={overlap}, name_bonus={name_bonus})");

        if total > best_score {
            best_score = total;
            best_name = name.clone();
        }
    }

    eprintln!("[intake/router] classified → {best_name} (score: {best_score})");
    best_name
}

/// Compose the prompt for `claude -p`. Format: agent persona, then
/// the operational context (ticket id, asker email, skill hint),
/// then the conversation history rendered as USER/ASSISTANT lines.
pub(super) fn build_chat_prompt(
    persona: &str,
    history: &[ChatMessage],
    ticket_id: &str,
    asker_email: &str,
) -> String {
    let mut prompt = String::new();
    prompt.push_str(persona);
    prompt.push_str("\n\n");
    prompt.push_str(
        "Operational context: You are running inside a chat-intake \
         turn. Use the `ai-intake` skill at `.claude/skills/ai-intake/SKILL.md` \
         for the file paths and field conventions. Use \
         `Bash node .claude/scripts/kb-search.mjs \"<query>\"` to find \
         relevant knowledge-base articles.\n\n",
    );
    prompt.push_str(&format!(
        "The asker's email is `{}` — captured in the gate form before \
         this chat started. You already have it; do NOT ask the user \
         for it again. Use this email as the `asker` and `sender` \
         field on the ticket and on conversation turns from the \
         asker, and as the key for the people row.\n\n",
        asker_email
    ));
    prompt.push_str(&format!(
        "The ticket id for this conversation is `{}`. Always use this \
         exact id when writing the ticket file at \
         `databases/tickets/<ticketId>.json`, the conversation \
         subfolder at `databases/conversations/<ticketId>/`, and as the \
         `ticketId` field on every conversation row. Do NOT create a \
         second ticket id for this session.\n\n",
        ticket_id
    ));
    prompt.push_str("Conversation so far:\n");
    for msg in history {
        let label = if msg.role == "user" {
            "USER"
        } else {
            "ASSISTANT"
        };
        prompt.push_str(&format!("{}: {}\n", label, msg.content));
        if !msg.attachments.is_empty() {
            // Inline the attachment paths so the agent knows which
            // files belong to this turn. Reading them is up to the
            // agent — for screenshots / diagrams the model can ingest
            // image content via the Read tool.
            for att in &msg.attachments {
                prompt.push_str(&format!("  [attachment: {}]\n", att));
            }
        }
    }
    if history.iter().any(|m| !m.attachments.is_empty()) {
        prompt.push_str(
            "\nWhen a USER turn lists attachments, use the Read tool on each \
             repo-relative path BEFORE deciding the outcome. Screenshots, \
             logs, and PDFs often carry the actual question (e.g. \"this?\" \
             with a screenshot of an error). Skipping the attachment and \
             escalating because the body looks vague is the wrong move.\n",
        );
    }
    prompt.push_str(
        "\nIMPORTANT: Do NOT write any conversation turn files (no \
         msg-*.json under databases/conversations/). The server \
         already wrote the asker's turn before invoking you, and the \
         server will write your agent reply turn after you finish \
         using your stdout as the body. If you write a turn yourself \
         it WILL appear duplicated in the admin UI.\n\n\
         Also do NOT Edit the ticket's `status` field — the server \
         sets it based on the marker you emit (see below), so an \
         agent-side Edit will race against the server and may be \
         clobbered.\n\n\
         Your job: (1) read the ticket + conversation history for \
         context, (2) run `Bash node .claude/scripts/kb-search.mjs \
         \"<query>\"` to search the local knowledge base when the \
         user is asking a new question — pass a compact query that \
         captures it, (3) decide one of exactly three outcomes — \
         `answered` (KB had a relevant article and you replied from \
         it; ticket → open), `escalated` (KB had no relevant match, \
         or the question needs a human; ticket → escalated), or \
         `resolved` (the asker has explicitly confirmed the case is \
         done — \"thanks that worked\" / \"all good\" / \"works now\" \
         — and a prior agent or admin turn provided the answer; \
         ticket → resolved, terminal), (4) output your reply to the \
         user, then (5) end with a status marker on its own line: \
         `<<STATUS:answered>>`, `<<STATUS:escalated>>`, or \
         `<<STATUS:resolved>>`.\n\n\
         The marker reflects your *turn outcome*, not just the case \
         lifecycle. Multiple `answered` turns in a row is normal for \
         ongoing back-and-forth. Use `resolved` only when you're \
         confident the asker is closing the loop — when in doubt, \
         emit `answered`; the admin can always close manually, and \
         the asker can reopen by sending another message.\n\n\
         CRITICAL: do NOT ask the user a follow-up question. There \
         is no \"clarifying\" outcome. If you can't answer from the \
         KB on the information you already have, escalate — the \
         admin will ask the asker any follow-ups themselves. Asking \
         the user another question instead of escalating leaves the \
         ticket stuck and frustrates the user.\n\n\
         The reply is what the user sees in the chat — conversational, \
         no file paths, no status narration, no meta-commentary. \
         Plain text only: no markdown formatting (no `**bold**`, no \
         `*italics*`, no `# headings`, no `- bullet lists`, no fenced \
         code blocks, no tables). The chat surface renders raw text \
         and so will the eventual Slack/Teams ingest, so markdown \
         shows through as literal asterisks and pound signs. If you \
         need to enumerate steps, use plain numbers (`1. `, `2. `) in \
         normal sentences. The server strips the marker line before \
         writing the turn. Missing or malformed marker → defaults to \
         escalated, so the admin still sees the ticket.",
    );
    prompt
}
