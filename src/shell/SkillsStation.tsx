import { useEffect, useRef, useState } from "react";
import { fsList, fsRead, entityWriteFile } from "../lib/api";
import { isDirectChild } from "../lib/paths";
import { writeToActiveSession } from "./activeSession";
import { Button } from "../ui";
import { useToast } from "../Toast";
import styles from "./ToolsPanel.module.css";

// Defuse CommonMark fences in user-provided intent before it lands
// in the markdown body. A pasted ``` (backtick) or ~~~ (tilde) run
// of length ≥ 3 would open a fenced code block that swallows the
// rest of the doc until the next matching fence or EOF. Splitting
// every run with a zero-width space keeps the visible characters
// intact but prevents the lexer from treating them as a fence.
function escapeMarkdownFences(s: string): string {
  return s
    .replace(/`{3,}/g, (run) => run.split("").join("​"))
    .replace(/~{3,}/g, (run) => run.split("").join("​"));
}

type CommandEntry = {
  name: string;
  description: string;
  path: string;
  /** Whether this is a featured command that Lisa cares about. */
  featured: boolean;
};

// Commands that map directly to Lisa's pain points, in priority order.
// Everything not in this list goes behind "Show more".
const FEATURED_COMMANDS: string[] = [
  "load-sample-data",        // Populate workspace with sample data
  "cleanup",                 // Remove sample data
  "salesforce-gmail",        // Salesforce + email disconnect
  "backup",                  // Manual backups
  "onboard",                 // Onboarding new employees
  "offboard",                // Offboarding departing employees
  "salesforce-data-quality",  // Data quality / cleanup in Salesforce
  "slack-to-knowledge",             // Knowledge trapped in Slack
  "patient-inquiry",          // Patient inquiry handling (Salesforce Cases)
  "drive-search",             // Information scattered across Drive
  "asset-tracking",           // Asset tracking
  "pipeline-outreach",        // Recurring reporting / outreach
  "report",                   // Custom reports
];

/**
 * CommandsStation — flat list of slash commands with a visible Run
 * button on each row. Merges system (.claude/skills/) and custom
 * (filestores/commands/) into one deduplicated list. System commands
 * appear first; extras are behind "Show more".
 */
export function CommandsStation({
  repo,
  fsTick,
  onOpen,
}: {
  repo: string;
  fsTick?: number;
  onOpen: (path: string) => void;
}) {
  const [commands, setCommands] = useState<CommandEntry[]>([]);
  const [showAll, setShowAll] = useState(false);
  const { show: showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const systemEntries: CommandEntry[] = [];
      const customEntries: CommandEntry[] = [];

      // System commands from .claude/skills/
      try {
        const root = `${repo}/.claude/skills`;
        const nodes = await fsList(root);
        const dirs = nodes.filter((n) => n.is_dir && isDirectChild(root, n.path));
        await Promise.all(
          dirs.map(async (d) => {
            const skillMdPath = `${d.path}/SKILL.md`;
            let description = "";
            try {
              const raw = await fsRead(skillMdPath);
              description = extractDescription(raw);
            } catch { /* SKILL.md missing */ }
            systemEntries.push({ name: d.name, description, path: skillMdPath, featured: FEATURED_COMMANDS.includes(d.name) });
          }),
        );
      } catch { /* .claude/skills/ doesn't exist */ }

      // Custom commands from filestores/commands/
      try {
        const root = `${repo}/filestores/commands`;
        const nodes = await fsList(root);
        const prefix = `${root.replace(/\\/g, "/")}/`;
        const files = nodes.filter((n) => {
          if (n.is_dir) return false;
          const p = n.path.replace(/\\/g, "/");
          const tail = p.startsWith(prefix) ? p.slice(prefix.length) : "";
          if (!tail || tail.includes("/")) return false;
          if (n.name.includes(".server.")) return false;
          return n.name.endsWith(".md");
        });
        await Promise.all(
          files.map(async (f) => {
            const name = f.name.replace(/\.md$/, "");
            let description = "";
            try {
              const raw = await fsRead(f.path);
              description = extractDescription(raw);
            } catch { /* unreadable */ }
            customEntries.push({ name, description, path: f.path, featured: FEATURED_COMMANDS.includes(name) });
          }),
        );
      } catch { /* filestores/commands/ doesn't exist */ }

      // Deduplicate: if a name exists in both system and custom, keep
      // the system version (it's the curated one).
      const seen = new Set<string>();
      const deduped: CommandEntry[] = [];
      // System first so they win on collisions and sort to the top.
      for (const e of systemEntries) {
        if (!seen.has(e.name)) {
          seen.add(e.name);
          deduped.push(e);
        }
      }
      for (const e of customEntries) {
        if (!seen.has(e.name)) {
          seen.add(e.name);
          deduped.push(e);
        }
      }
      // Featured commands first (in Lisa's priority order), then the
      // rest alphabetically behind "Show more".
      deduped.sort((a, b) => {
        const aIdx = FEATURED_COMMANDS.indexOf(a.name);
        const bIdx = FEATURED_COMMANDS.indexOf(b.name);
        const aFeat = aIdx !== -1;
        const bFeat = bIdx !== -1;
        if (aFeat && bFeat) return aIdx - bIdx;
        if (aFeat) return -1;
        if (bFeat) return 1;
        return a.name.localeCompare(b.name);
      });

      if (!cancelled) setCommands(deduped);
    })();
    return () => { cancelled = true; };
  }, [repo, fsTick]);

  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newIntent, setNewIntent] = useState("");

  // When searching, show all matches (ignore fold). Otherwise fold at featured.
  const q = search.toLowerCase();
  const filtered = q
    ? commands.filter((c) => c.name.includes(q) || c.description.toLowerCase().includes(q))
    : commands;
  const featuredCount = filtered.filter((c) => c.featured).length;
  const foldAt = Math.max(featuredCount, 1);
  const visible = q || showAll ? filtered : filtered.slice(0, foldAt);
  const hiddenCount = filtered.length - foldAt;
  const [showNewInput, setShowNewInput] = useState(false);
  // In-flight guard: a fast double-click on Create (or Enter +
  // immediate second Enter) could otherwise launch two write
  // pipelines back-to-back, each ending in a `writeToActiveSession`
  // call. Claude would receive two build-out prompts for the same
  // command. (BugBot finding.) Plain `useState` would cause a
  // re-render in the middle of the async body — `useRef` is what we
  // want for "set true, do work, set false" semantics.
  const creatingRef = useRef(false);

  const createNewCommand = async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      await createNewCommandInner();
    } finally {
      creatingRef.current = false;
    }
  };

  const createNewCommandInner = async () => {
    const slug = newName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    // Names that strip to nothing (non-ASCII, punctuation-only, etc.)
    // must surface as an error — silently no-op'ing here was the
    // cause of "I clicked Create three times and nothing happened"
    // reports. (Independent reviewer finding.)
    if (!slug) {
      showToast({
        title: "Name required",
        message:
          "Use letters, numbers, and dashes for the command name. Non-ASCII names aren't supported as slash-command identifiers.",
        tone: "warn",
      });
      return;
    }
    // Intent is required — captured before any file is written or any
    // Claude call is made. The single text field carries the user's
    // ask through to Claude's initial turn so it stops guessing from
    // the filename alone. (PIN-6607.)
    const intent = newIntent.trim();
    if (!intent) return;
    // Refuse to overwrite an existing command — the previous shape
    // happily clobbered `filestores/commands/<slug>.md` with the
    // fresh boilerplate, taking the user's accumulated body with it.
    const collidesWith = commands.find((c) => c.name === slug);
    if (collidesWith) {
      showToast({
        title: `/${slug} already exists`,
        message:
          "Pick a different name, or open the existing command and edit it instead.",
        tone: "warn",
      });
      return;
    }
    // One-line description for the YAML frontmatter — keep the user's
    // exact phrasing so it round-trips through the commands list and
    // Claude has it in its working set. Backslash and double-quote
    // both need escaping in a YAML double-quoted scalar; without the
    // backslash escape, a Windows path like `C:\Users\me\` produces
    // an unterminated quoted string and downstream YAML parsers drop
    // or error on the file.
    const safeIntentForFrontmatter = intent
      .replace(/\r?\n/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    // Body needs separate escaping: frontmatter is YAML-quoted (so
    // backticks are safe inside), but the body is raw markdown — a
    // pasted ``` would close the doc's code fences and corrupt the
    // first paint until Claude rewrites the file.
    const safeIntentForBody = escapeMarkdownFences(intent);
    const boilerplate = `---
description: "${safeIntentForFrontmatter}"
---

# /${slug}

<!-- This is a slash command. When you type /${slug} in the chat,
     Claude will follow these instructions step by step. -->

## What this command does

${safeIntentForBody}

## Steps

1. First, ask the user what they need.
2. Then, do the work.
3. Finally, confirm the result.

## Notes

- Add any tips, edge cases, or context here.

## After this run

Before signing off, re-read this command body. If the admin's choices narrowed any defaults this run, rewrite the relevant sections to match — and snapshot the prior body to \`filestores/commands/${slug}/_history/<ms>.md\` first. Tell the admin in one line what changed.
`;
    const relPath = `filestores/commands/${slug}.md`;
    const absPath = `${repo}/${relPath}`;
    await entityWriteFile(repo, "filestores/commands", `${slug}.md`, boilerplate);
    setShowNewInput(false);
    setNewName("");
    setNewIntent("");
    onOpen(absPath);
    // Hand the intent off to Claude alongside the file path. Building
    // this prompt server-side (here) instead of relying on the
    // template means Claude gets the user's ask verbatim in its first
    // turn, even if it never reads the file. The file watcher in the
    // viewer then re-renders as Claude writes.
    const ccPrompt = `I just created a new slash command at \`${relPath}\`. Please build it out so it does the following:\n\n${intent}\n\nRead the file first to see the scaffold I dropped (YAML frontmatter, Steps, Notes), then rewrite the body so /${slug} actually does the above. Keep the frontmatter \`description\` matching the goal. When you're done, tell me in one line what /${slug} now does.\r`;
    const handed = await writeToActiveSession(ccPrompt);
    if (!handed) {
      // The file is on disk and the viewer is open — but Claude was
      // not invoked because no PTY session is active. Surface that
      // out loud so the user doesn't sit waiting for Claude to fill
      // in the template that will never get filled. (PIN-6607.)
      showToast({
        title: "Claude session not active",
        message:
          `Created /${slug} on disk, but no Claude session is running in the chat pane — the build-out request was not sent. Start a Claude session, then ask it to build out the new command.`,
        tone: "warn",
      });
    }
  };

  const cancelNewCommand = () => {
    setShowNewInput(false);
    setNewName("");
    setNewIntent("");
  };

  return (
    <div className={styles.panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <p className={styles.tagline} style={{ margin: 0 }}>
          Click a command to view or edit. Hit Run to execute.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowNewInput((v) => !v)}
        >
          + New
        </Button>
      </div>

      <input
        className={styles.search}
        type="text"
        placeholder="Search commands…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {showNewInput && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}
          role="dialog"
          aria-label="Create new command"
        >
          <input
            className={styles.search}
            type="text"
            placeholder="command-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              // Enter on the name input submits when both fields are
              // filled — restores the pre-PIN-6607 muscle memory
              // without overriding plain-Enter-as-newline inside the
              // intent textarea below.
              if (e.key === "Enter") {
                e.preventDefault();
                if (newName.trim() && newIntent.trim()) {
                  void createNewCommand();
                }
              }
              if (e.key === "Escape") cancelNewCommand();
            }}
            autoFocus
          />
          <textarea
            className={styles.search}
            placeholder="What should this command do? Describe the goal."
            value={newIntent}
            onChange={(e) => setNewIntent(e.target.value)}
            onKeyDown={(e) => {
              // Submit on Cmd/Ctrl+Enter so plain Enter still inserts
              // a newline inside the textarea — matches the modern
              // chat-input convention.
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void createNewCommand();
              }
              if (e.key === "Escape") cancelNewCommand();
            }}
            rows={3}
            style={{ resize: "vertical", minHeight: 64, fontFamily: "inherit" }}
            aria-label="What should this command do? Describe the goal."
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: "auto" }}>
              Cmd/Ctrl+Enter to create
            </span>
            <Button variant="ghost" size="sm" onClick={cancelNewCommand}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void createNewCommand()}
              disabled={!newName.trim() || !newIntent.trim()}
            >
              Create
            </Button>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <div className={styles.empty}>{q ? "No matching commands." : "No commands found."}</div>
      ) : (
        <div className={styles.grid}>
          {visible.map((cmd) => (
            <div
              key={cmd.name}
              className={styles.card}
              style={{ cursor: "pointer" }}
              onClick={() => onOpen(cmd.path)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onOpen(cmd.path);
              }}
            >
              <div className={styles.cardHeader}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--text)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>/</span>
                  {cmd.name}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    writeToActiveSession(`/${cmd.name}\r`);
                  }}
                >
                  Run
                </Button>
              </div>
              {cmd.description && (
                <p className={styles.cardDesc}>{cmd.description}</p>
              )}
            </div>
          ))}

          {hiddenCount > 0 && !q && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              style={{
                all: "unset",
                cursor: "pointer",
                textAlign: "center",
                padding: "10px 0",
                fontSize: 13,
                color: "var(--text-muted)",
                fontWeight: 500,
              }}
            >
              {showAll
                ? "Show less"
                : `Show ${hiddenCount} more command${hiddenCount === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Extract a one-line description from markdown with optional YAML frontmatter. */
function extractDescription(raw: string): string {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const descLine = fmMatch[1]
      .split("\n")
      .find((l) => l.trim().startsWith("description:"));
    if (descLine) {
      return descLine
        .replace(/^description:\s*/, "")
        .replace(/^["']|["']$/g, "")
        .trim();
    }
  }
  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    return trimmed.slice(0, 140);
  }
  return "";
}

// Keep backward-compatible export name for existing import sites.
export { CommandsStation as SkillsStation };
