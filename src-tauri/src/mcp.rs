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
    pub source: String,    // "claude-code" | "claude-desktop" | "project"
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
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(PathBuf::from)
}

/// Claude Desktop config path — platform-specific.
fn claude_desktop_config_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = home_dir()?;
        Some(home.join("Library/Application Support/Claude/claude_desktop_config.json"))
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA").ok().map(|appdata| {
            PathBuf::from(appdata)
                .join("Claude")
                .join("claude_desktop_config.json")
        })
    }
    #[cfg(target_os = "linux")]
    {
        let home = home_dir()?;
        Some(home.join(".config/Claude/claude_desktop_config.json"))
    }
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

/// Read project-scoped MCP servers from `~/.claude.json`. Claude Code
/// stores these under `.projects.<absolute_path>.mcpServers` when you
/// run `claude mcp add` inside a project directory.
fn read_project_scoped_mcps(claude_json: &PathBuf, repo_path: &str) -> Vec<InstalledMcp> {
    let raw = match fs::read_to_string(claude_json) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let projects = match parsed.get("projects") {
        Some(serde_json::Value::Object(map)) => map,
        _ => return Vec::new(),
    };
    // The key is the absolute repo path. Try exact match first,
    // then try with/without trailing slash.
    let project = projects
        .get(repo_path)
        .or_else(|| projects.get(&format!("{}/", repo_path)))
        .or_else(|| projects.get(repo_path.trim_end_matches('/')));
    let servers = match project {
        Some(proj) => match proj.get("mcpServers") {
            Some(serde_json::Value::Object(map)) => map,
            _ => return Vec::new(),
        },
        None => return Vec::new(),
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
            source: "claude-code-project".to_string(),
            transport,
            command_or_url,
        });
    }
    result
}

/// List all MCP servers installed across Claude Code config, Claude
/// Desktop config, and the project-level configs. Dedupes by name
/// (first source wins). Missing/malformed files are silently skipped.
#[tauri::command]
pub fn list_installed_mcps(repo: Option<String>) -> Vec<InstalledMcp> {
    let mut seen = HashMap::new();
    let mut result = Vec::new();

    // 1. ~/.claude.json — project-scoped servers (most specific)
    if let (Some(home), Some(ref repo_path)) = (home_dir(), &repo) {
        let path = home.join(".claude.json");
        for mcp in read_project_scoped_mcps(&path, repo_path) {
            if !seen.contains_key(&mcp.name) {
                seen.insert(mcp.name.clone(), true);
                result.push(mcp);
            }
        }
    }

    // 2. ~/.claude.json — user-level servers
    if let Some(home) = home_dir() {
        let path = home.join(".claude.json");
        for mcp in read_mcp_servers_from_file(&path, "claude-code") {
            if !seen.contains_key(&mcp.name) {
                seen.insert(mcp.name.clone(), true);
                result.push(mcp);
            }
        }
    }

    // 3. Claude Desktop config (platform-specific path)
    if let Some(path) = claude_desktop_config_path() {
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
        let path = PathBuf::from(repo_path)
            .join(".claude")
            .join("settings.local.json");
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
