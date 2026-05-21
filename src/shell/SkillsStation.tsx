import { useEffect, useState } from "react";
import { fsList, fsRead, entityWriteFile } from "../lib/api";
import { isDirectChild } from "../lib/paths";
import { writeToActiveSession } from "./activeSession";
import { Button } from "../ui";
import styles from "./ToolsPanel.module.css";

type CommandOrigin = "system" | "custom";

type CommandEntry = {
  name: string;
  description: string;
  /** The path used for open / edit / delete — always the source-of-truth
   * for that command. For commands that exist in `filestores/commands/`,
   * this is the filestore path (the mirror at `.claude/skills/<slug>/`
   * is one-way and gets overwritten on every sync — never operate on it
   * directly). For system-only commands that have no filestore source,
   * this is the `.claude/skills/<slug>/SKILL.md` path. */
  path: string;
  origin: CommandOrigin;
};

/**
 * CommandsStation — flat list of slash commands with a visible Run
 * button on each row. Merges system (`.claude/skills/`) and custom
 * (`filestores/commands/`) into one alphabetised list. When the same
 * slug exists in both places, the custom entry wins because that's the
 * editable source of truth.
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
            systemEntries.push({
              name: d.name,
              description,
              path: skillMdPath,
              origin: "system",
            });
          }),
        );
      } catch { /* .claude/skills/ doesn't exist */ }

      // Custom commands from filestores/commands/
      try {
        const root = `${repo}/filestores/commands`;
        const nodes = await fsList(root);
        const files = nodes.filter((n) => {
          if (n.is_dir) return false;
          if (!isDirectChild(root, n.path)) return false;
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
            customEntries.push({
              name,
              description,
              path: f.path,
              origin: "custom",
            });
          }),
        );
      } catch { /* filestores/commands/ doesn't exist */ }

      const merged = mergeCommandEntries(systemEntries, customEntries);
      if (!cancelled) setCommands(merged);
    })();
    return () => { cancelled = true; };
  }, [repo, fsTick]);

  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newIntent, setNewIntent] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [showNewInput, setShowNewInput] = useState(false);

  const q = search.toLowerCase();
  const visible = q
    ? commands.filter(
        (c) =>
          c.name.includes(q) || c.description.toLowerCase().includes(q),
      )
    : commands;

  const intentValid = newIntent.trim().length >= 10;
  const slugValid = !!newName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  const resetNewInput = () => {
    setShowNewInput(false);
    setNewName("");
    setNewIntent("");
    setCreateError(null);
  };

  const createNewCommand = async () => {
    const slug = newName
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const intent = newIntent.trim();
    if (!slug) {
      setCreateError("Pick a slug (letters, numbers, dashes).");
      return;
    }
    if (intent.length < 10) {
      setCreateError("Describe what this command should do (at least 10 characters).");
      return;
    }
    const boilerplate = renderDraftBoilerplate(slug, intent);
    try {
      await entityWriteFile(repo, "filestores/commands", `${slug}.md`, boilerplate);
    } catch (err) {
      setCreateError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    resetNewInput();
    onOpen(`${repo}/filestores/commands/${slug}.md`);
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
            if (showNewInput) {
              resetNewInput();
            } else {
              setShowNewInput(true);
            }
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
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 }}>
          <input
            className={styles.search}
            type="text"
            placeholder="command-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") resetNewInput();
            }}
            autoFocus
          />
          <textarea
            className={styles.search}
            placeholder="What should this command do? (e.g. 'Pull this week's open Salesforce opportunities and summarise by stage.')"
            value={newIntent}
            onChange={(e) => setNewIntent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") resetNewInput();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                void createNewCommand();
              }
            }}
            rows={3}
            style={{ resize: "vertical", fontFamily: "inherit" }}
          />
          {createError && (
            <span style={{ fontSize: 12, color: "var(--text-error, #b42318)" }}>
              {createError}
            </span>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void createNewCommand()}
              disabled={!slugValid || !intentValid}
            >
              Create
            </Button>
            <Button variant="ghost" size="sm" onClick={resetNewInput}>
              Cancel
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
              key={`${cmd.origin}:${cmd.name}`}
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
        </div>
      )}
    </div>
  );
}

/**
 * Merge system + custom command entries into two ordered groups:
 * system first (alphabetical), then custom (alphabetical). When the
 * same slug exists in both, the custom entry wins because that's the
 * editable source-of-truth — `.claude/skills/` is a one-way mirror
 * that gets overwritten on every sync. An overridden command moves
 * into the custom group (it carries `origin: "custom"`).
 */
export function mergeCommandEntries(
  systemEntries: CommandEntry[],
  customEntries: CommandEntry[],
): CommandEntry[] {
  const customNames = new Set(customEntries.map((e) => e.name));
  const systemKept = systemEntries
    .filter((e) => !customNames.has(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const customSorted = [...customEntries].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return [...systemKept, ...customSorted];
}

/** Boilerplate for a freshly-created draft command. The `status: draft`
 * YAML field is what gates Claude's "be proactive about commands"
 * behaviour — drafts are treated as intent placeholders, not runnable
 * commands. The intent line shows up in command-discovery so the admin
 * can find the draft later. */
export function renderDraftBoilerplate(slug: string, intent: string): string {
  // YAML 1.2 single-quoted scalar: only `'` needs escaping (doubled).
  // The intent comes from a textarea so it can legitimately contain
  // `"`, `\`, or stray whitespace — single-quoted YAML handles all of
  // those without escaping. We also collapse internal newlines to a
  // single space so the `description:` field stays on one line (some
  // YAML parsers permit folded scalars but the markdown body below
  // already carries the multiline intent verbatim, which is what the
  // admin will actually edit).
  const oneLineIntent = intent.replace(/\s+/g, " ").trim();
  const safeIntent = oneLineIntent.replace(/'/g, "''");
  return `---
description: '${safeIntent}'
status: draft
---

# /${slug}

> **Draft.** Defined intent: ${oneLineIntent}
>
> Fill in the steps below before invoking. Claude won't auto-build a draft.

## What this command does

${intent}

## Steps

1. (Define the first step.)
2. (Define the second step.)
3. (Define the final step.)

## Notes

- (Optional context, edge cases, prerequisites.)

## After this run

Once this command is no longer a draft, remove the \`status: draft\` line above. When the admin's choices narrow defaults during a run, rewrite the relevant sections to match — and snapshot the prior body to \`filestores/commands/${slug}/_history/<ms>.md\` first. Tell the admin in one line what changed.
`;
}

/** Extract a one-line description from markdown with optional YAML
 * frontmatter. Handles both quoted scalar styles per YAML 1.2: single
 * quotes (`'foo''s'` → `foo's`) and double quotes (`"a\\\"b"` → `a"b`).
 * Drafts created via `renderDraftBoilerplate` use the single-quoted
 * form, so unescaping `''` here is what keeps the description display
 * matching what the admin typed. */
export function extractDescription(raw: string): string {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const descLine = fmMatch[1]
      .split("\n")
      .find((l) => l.trim().startsWith("description:"));
    if (descLine) {
      const value = descLine.replace(/^\s*description:\s*/, "").trim();
      if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
        return value.slice(1, -1).replace(/''/g, "'");
      }
      if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        return value
          .slice(1, -1)
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      }
      return value;
    }
  }
  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(">")) continue;
    return trimmed.slice(0, 140);
  }
  return "";
}

// Keep backward-compatible export name for existing import sites.
export { CommandsStation as SkillsStation };
