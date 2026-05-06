//! MCP server discovery — reads Claude Code's config files to find
//! which MCP servers the user has installed. Tolerant: missing or
//! malformed files return empty lists, never errors.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

/// One installed MCP server as read from Claude's config.
#[derive(Serialize, Clone, Debug)]
pub struct InstalledMcp {
    pub name: String,
    pub source: String, // "claude-code" | "claude-desktop" | "project"
    pub transport: String, // "stdio" | "http" | "sse"
    pub command_or_url: String,
}

/// The shape of mcpServers entries in Claude's config files.
/// Both `~/.claude.json` and `claude_desktop_config.json` use this shape.
#[derive(Deserialize, Debug)]
struct McpServerEntry {
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    args: Option<Vec<String>>,
    #[serde(default)]
    url: Option<String>,
    #[serde(rename = "type", default)]
    transport_type: Option<String>,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(PathBuf::from)
}

/// Read MCP servers from a JSON file that has a top-level `mcpServers` key.
fn read_mcp_servers_from_file(path: &PathBuf, source: &str) -> Vec<InstalledMcp> {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let servers = match parsed.get("mcpServers") {
        Some(serde_json::Value::Object(map)) => map,
        _ => return Vec::new(),
    };

    let mut result = Vec::new();
    for (name, value) in servers {
        let entry: McpServerEntry = match serde_json::from_value(value.clone()) {
            Ok(e) => e,
            Err(_) => continue,
        };

        let (transport, command_or_url) = if let Some(url) = &entry.url {
            let t = entry.transport_type.as_deref().unwrap_or("http");
            (t.to_string(), url.clone())
        } else if let Some(cmd) = &entry.command {
            let full = if let Some(args) = &entry.args {
                format!("{} {}", cmd, args.join(" "))
            } else {
                cmd.clone()
            };
            ("stdio".to_string(), full)
        } else {
            continue;
        };

        result.push(InstalledMcp {
            name: name.clone(),
            source: source.to_string(),
            transport,
            command_or_url,
        });
    }
    result
}

/// List all MCP servers installed across Claude Code config, Claude
/// Desktop config, and the project-level `.mcp.json`. Dedupes by name
/// (first source wins). Missing/malformed files are silently skipped.
#[tauri::command]
pub fn list_installed_mcps(repo: Option<String>) -> Vec<InstalledMcp> {
    let mut seen = HashMap::new();
    let mut result = Vec::new();

    // 1. ~/.claude.json (Claude Code user-level config)
    if let Some(home) = home_dir() {
        let path = home.join(".claude.json");
        for mcp in read_mcp_servers_from_file(&path, "claude-code") {
            if !seen.contains_key(&mcp.name) {
                seen.insert(mcp.name.clone(), true);
                result.push(mcp);
            }
        }
    }

    // 2. Claude Desktop config
    if let Some(home) = home_dir() {
        let path = home
            .join("Library")
            .join("Application Support")
            .join("Claude")
            .join("claude_desktop_config.json");
        for mcp in read_mcp_servers_from_file(&path, "claude-desktop") {
            if !seen.contains_key(&mcp.name) {
                seen.insert(mcp.name.clone(), true);
                result.push(mcp);
            }
        }
    }

    // 3. Project-level .claude/settings.local.json
    // `claude mcp add` writes project-scoped servers here.
    if let Some(ref repo_path) = repo {
        let path = PathBuf::from(repo_path).join(".claude").join("settings.local.json");
        for mcp in read_mcp_servers_from_file(&path, "project") {
            if !seen.contains_key(&mcp.name) {
                seen.insert(mcp.name.clone(), true);
                result.push(mcp);
            }
        }
    }

    // 4. Project-level .mcp.json (legacy / manual config)
    if let Some(repo_path) = repo {
        let path = PathBuf::from(&repo_path).join(".mcp.json");
        for mcp in read_mcp_servers_from_file(&path, "project") {
            if !seen.contains_key(&mcp.name) {
                seen.insert(mcp.name.clone(), true);
                result.push(mcp);
            }
        }
    }

    result
}
