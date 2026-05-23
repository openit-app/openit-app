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
  // Per-pipeline cancellation token. cancelNewCommand bumps this; the
  // inner pipeline checks at every async boundary and bails before
  // mutating disk or the PTY. (BugBot finding — Escape/Cancel during
  // the live re-list otherwise still went on to write the file.)
  const createGenRef = useRef(0);

  const createNewCommand = async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    const myGen = ++createGenRef.current;
    try {
      await createNewCommandInner(myGen);
    } catch (err) {
      // Any throw inside the inner pipeline — entityWriteFile failing
      // permission checks, a Tauri IPC error from writeToActiveSession,
      // etc. — needs to land in a user-visible toast. Without this the
      // user sees the dialog close (or not) and the file is in an
      // unknown state, with only the dev console as a clue.
      console.error("[commands] +New failed:", err);
      showToast({
        title: "Couldn't create command",
        message: err instanceof Error ? err.message : String(err),
        tone: "critical",
      });
    } finally {
      // Only clear the guard if THIS pipeline still owns it. After
      // the early release at the point-of-no-return, the user can
      // start a second pipeline while this one's PTY write is still
      // pending. When the await unblocks and `finally` fires, P2 is
      // mid-flight and owns the guard — clearing it here would let
      // a third concurrent click slip through. The inner release
      // already covers the success path, so finally only matters on
      // the early-return / throw branches where this pipeline still
      // owns the guard. (Independent reviewer iter-6 finding.)
      if (createGenRef.current === myGen) {
        creatingRef.current = false;
      }
    }
  };

  // Inputs are valid for submit: name slugs to something, intent is
  // non-empty after trim. Exposed so the keyboard-shortcut handlers
  // can short-circuit before calling createNewCommand — symmetric
  // with the Create button's `disabled` prop.
  const canSubmitNewCommand = (): boolean =>
    newName.trim().length > 0 && newIntent.trim().length > 0;

  const createNewCommandInner = async (gen: number) => {
    // Helper: true if the user cancelled this submission since we
    // started. Called at every async boundary below.
    const cancelled = () => createGenRef.current !== gen;
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
    if (!intent) {
      // The disabled-button and Enter-on-name gates already block this
      // path, but Cmd/Ctrl+Enter on the textarea bypasses them — guard
      // here with the same toast shape as the empty-slug case so the
      // failure isn't silent. (Independent reviewer finding.)
      showToast({
        title: "Intent required",
        message: "Describe what this command should do before submitting.",
        tone: "warn",
      });
      return;
    }
    // Refuse to overwrite an existing command — the previous shape
    // happily clobbered `filestores/commands/<slug>.md` with the
    // fresh boilerplate, taking the user's accumulated body with it.
    // Distinguish system commands (under `.claude/skills/`) from
    // user commands (under `filestores/commands/`) so the toast
    // points the user at the right next action. Compare
    // case-insensitively because macOS HFS+ and Windows NTFS treat
    // `Backup.md` and `backup.md` as the same file — a strict
    // equality check would let us write `backup.md` on top of an
    // existing `Backup.md`. (BugBot finding.)
    const collidesWith = commands.find(
      (c) => c.name.toLowerCase() === slug,
    );
    if (collidesWith) {
      // Normalise backslashes → forward slashes before the substring
      // check. fsList on Windows returns paths with `\\`, so the
      // bare `/.claude/skills/` check misclassifies system commands
      // as user commands there. (BugBot finding.)
      const normPath = collidesWith.path.replace(/\\/g, "/");
      const isSystem = normPath.includes("/.claude/skills/");
      showToast({
        title: isSystem
          ? `/${slug} is a system command`
          : `/${slug} already exists`,
        message: isSystem
          ? "This name is reserved by a built-in command. Pick a different name for your custom command."
          : "Pick a different name, or open the existing command and edit it instead.",
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
    // Last-chance TOCTOU narrowing — re-list the commands dir and
    // refuse the write if the file appeared between the cached check
    // above and now. We can't fully close the race without a
    // create-new flag on the Rust side (followup ticket), but this
    // catches the realistic case where Claude in the chat pane wrote
    // the file while the user was typing the intent.
    try {
      const live = await fsList(`${repo}/filestores/commands`);
      if (cancelled()) return;
      // Case-insensitive compare: HFS+/NTFS treat `Foo.md` and
      // `foo.md` as the same file. Strict equality would let us
      // overwrite a case-variant on those volumes.
      const target = `${slug}.md`;
      const collide = live.some(
        (n) => !n.is_dir && n.name.toLowerCase() === target,
      );
      if (collide) {
        showToast({
          title: `/${slug} already exists`,
          message:
            "Another process created this command while you were typing. Pick a different name or open the existing file.",
          tone: "warn",
        });
        return;
      }
    } catch {
      // `filestores/commands` may not exist yet — that's fine, the
      // write below will create it. But ANY other fsList failure
      // (permissions, transient IO) shouldn't silently skip the
      // collision check — fall back on the cached `commands` state
      // we already inspected above. That cache might be stale, but
      // it's strictly better than nothing.
      if (cancelled()) return;
      // (The cached check at the top of the function already ran;
      //  we'd have early-returned if it found a collision. Nothing
      //  more we can do here without a richer fs API.)
    }
    if (cancelled()) return;
    await entityWriteFile(repo, "filestores/commands", `${slug}.md`, boilerplate);
    // POINT OF NO RETURN — the file is committed to disk. From here
    // on, ignore the cancel token FOR THIS pipeline's disk + PTY
    // actions (a late Cancel would strand an orphan file with no
    // viewer and no Claude handoff, worse than completing).
    //
    // BUT: only mutate the dialog form state if no LATER pipeline
    // has started. The realistic race: user clicks Create on
    // 'alpha' → entityWriteFile in flight → user Cancels → opens
    // dialog again → types 'beta'. When alpha's write resolves we
    // must not wipe 'beta'. The gen check is symmetric with the
    // pre-write guards and surfaced as part of the same token.
    // (Independent reviewer iter-6 finding.)
    if (!cancelled()) {
      setShowNewInput(false);
      setNewName("");
      setNewIntent("");
    }
    onOpen(absPath);
    // Release the double-submit guard NOW — the dialog has closed,
    // the file is on disk, and the user might immediately click
    // `+ New` again to create a second command. Holding the ref
    // through the PTY write below would silently block that second
    // submit until Claude finished acknowledging the first one (PTY
    // writes can stall for hundreds of ms on a busy session).
    // (Independent reviewer iter-4 finding.)
    creatingRef.current = false;
    // Hand the intent off to Claude alongside the file path. Building
    // this prompt server-side (here) instead of relying on the
    // template means Claude gets the user's ask verbatim in its first
    // turn, even if it never reads the file. The file watcher in the
    // viewer then re-renders as Claude writes.
    const ccPrompt = `I just created a new slash command at \`${relPath}\`. Please build it out so it does the following:\n\n${intent}\n\nRead the file first to see the scaffold I dropped (YAML frontmatter, Steps, Notes), then rewrite the body so /${slug} actually does the above. Keep the frontmatter \`description\` matching the goal. When you're done, tell me in one line what /${slug} now does.\r`;
    // Wrap the handoff so a thrown PTY/IPC error gets the same warn
    // toast as the "no active session" branch — without this, the
    // user sees the dialog vanish and waits forever for Claude to
    // fill in the template.
    let handed = false;
    try {
      handed = await writeToActiveSession(ccPrompt);
    } catch (err) {
      console.error("[commands] writeToActiveSession threw:", err);
    }
    if (!handed) {
      // The file is on disk and the viewer is open — but Claude was
      // not invoked because no PTY session is active (or the write
      // failed). Surface that out loud so the user doesn't sit
      // waiting for Claude to fill in the template that will never
      // get filled. (PIN-6607.)
      showToast({
        title: "Claude session not active",
        message:
          `Created /${slug} on disk, but no Claude session is running in the chat pane — the build-out request was not sent. Start a Claude session, then ask it to build out the new command.`,
        tone: "warn",
      });
    }
  };

  const cancelNewCommand = () => {
    // Bump the generation so any in-flight createNewCommandInner
    // (mid-fsList, mid-write) bails before mutating disk or the PTY.
    createGenRef.current += 1;
    // Release the double-submit guard too — without this, an inner
    // pipeline that hits the post-fsList `cancelled()` early-return
    // skips the inline release at the point-of-no-return, and the
    // outer finally's gen-equality check now refuses to clear the
    // guard (gen has been bumped past this pipeline). Result:
    // creatingRef stays true for the lifetime of the component and
    // every subsequent Create silently no-ops. (BugBot iter-7 and
    // independent reviewer iter-7 both caught this regression.)
    creatingRef.current = false;
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
          onClick={() => {
            // Toggling + New must dismiss in-flight creation the same
            // way Cancel does — otherwise clicking + New to "close"
            // the composer while a create is mid-fsList still lands
            // on disk and fires Claude. Route the toggle-off branch
            // through cancelNewCommand so the gen token bumps and
            // the form clears consistently. (BugBot iter-6 finding.)
            if (showNewInput) cancelNewCommand();
            else setShowNewInput(true);
          }}
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
                if (canSubmitNewCommand()) void createNewCommand();
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
              // chat-input convention. Gate on the same validity
              // check the Create button uses so a stray keypress on a
              // half-filled form doesn't reach the inner pipeline.
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (canSubmitNewCommand()) void createNewCommand();
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
              disabled={!canSubmitNewCommand()}
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
