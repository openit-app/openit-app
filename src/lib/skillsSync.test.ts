// Tests for the manifest-file routing table. routeFile is a pure
// function that maps a manifest entry's logical path to a concrete
// (subdir, filename) on disk, with optional {{slug}} substitution
// inside the file body. Getting any of these mappings wrong silently
// corrupts user folders (rows in the wrong dir, agents with literal
// "{{slug}}" placeholders, schemas missing), so each rule is locked
// down with an explicit case.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { routeFile, syncSkillsToDisk } from "./skillsSync";

describe("routeFile", () => {
  const slug = "my-helpdesk";

  describe("CLAUDE.md", () => {
    it("routes to repo root", () => {
      expect(routeFile("CLAUDE.md", slug)).toEqual({
        subdir: "",
        filename: "CLAUDE.md",
        substituteSlug: false,
      });
    });

    it("routes the legacy template name to the same place", () => {
      expect(routeFile("claude-md.template.md", slug)).toEqual({
        subdir: "",
        filename: "CLAUDE.md",
        substituteSlug: false,
      });
    });
  });

  describe("commands/", () => {
    it("expands name to .claude/skills/<name>/SKILL.md", () => {
      expect(routeFile("commands/report.md", slug)).toEqual({
        subdir: ".claude/skills/report",
        filename: "SKILL.md",
        substituteSlug: false,
      });
    });

    it("handles multi-word command names", () => {
      expect(routeFile("commands/answer-ticket.md", slug)).toEqual({
        subdir: ".claude/skills/answer-ticket",
        filename: "SKILL.md",
        substituteSlug: false,
      });
    });
  });

  describe("schemas/", () => {
    it("routes <col>._schema.json to databases/<col>/_schema.json (slug-free)", () => {
      expect(routeFile("schemas/tickets._schema.json", slug)).toEqual({
        subdir: "databases/tickets",
        filename: "_schema.json",
        substituteSlug: false,
      });
    });

    it("handles people schema the same way", () => {
      expect(routeFile("schemas/people._schema.json", "local")).toEqual({
        subdir: "databases/people",
        filename: "_schema.json",
        substituteSlug: false,
      });
    });
  });

  describe("agents/<name>.template.json", () => {
    it("strips .template suffix; lands at agents/<name>.json (slug-free)", () => {
      expect(routeFile("agents/triage.template.json", slug)).toEqual({
        subdir: "agents",
        filename: "triage.json",
        substituteSlug: false,
      });
    });

    it("preserves the folder structure for nested agent templates", () => {
      expect(routeFile("agents/triage/triage.template.json", slug)).toEqual({
        subdir: "agents/triage",
        filename: "triage.json",
        substituteSlug: false,
      });
    });

    it("routes nested .md files under agents/<folder> through the default rule", () => {
      // Nested agent .md files (not top-level) fall through to the
      // default rule which preserves the original path structure.
      expect(routeFile("agents/triage/common.md", slug)).toEqual({
        subdir: "agents/triage",
        filename: "common.md",
        substituteSlug: false,
      });
    });

    it("non-template agent files preserved as-is", () => {
      expect(routeFile("agents/some-other.json", slug)).toEqual({
        subdir: "agents",
        filename: "some-other.json",
        substituteSlug: false,
      });
    });
  });

  describe("scripts/", () => {
    it("routes scripts/<file> to .claude/scripts/<file>", () => {
      expect(routeFile("scripts/sync-push.mjs", slug)).toEqual({
        subdir: ".claude/scripts",
        filename: "sync-push.mjs",
        substituteSlug: false,
      });
    });

    it("preserves dotfile names under scripts/", () => {
      expect(routeFile("scripts/.helper.mjs", slug)).toEqual({
        subdir: ".claude/scripts",
        filename: ".helper.mjs",
        substituteSlug: false,
      });
    });
  });

  describe("seed/", () => {
    it("routes seed/commands/<name>.md to filestores/commands/<name>.md", () => {
      expect(routeFile("seed/commands/backup.md", slug)).toEqual({
        subdir: "filestores/commands",
        filename: "backup.md",
        substituteSlug: false,
      });
    });

    it("routes seed/<target>/<file> to .claude/seed/<target>/<file>", () => {
      expect(routeFile("seed/tickets/sample-ticket-1.json", slug)).toEqual({
        subdir: ".claude/seed/tickets",
        filename: "sample-ticket-1.json",
        substituteSlug: false,
      });
    });

    it("preserves nested seed/conversations/<ticketId>/<file> structure", () => {
      expect(
        routeFile("seed/conversations/sample-ticket-1/msg-aa01.json", slug),
      ).toEqual({
        subdir: ".claude/seed/conversations/sample-ticket-1",
        filename: "msg-aa01.json",
        substituteSlug: false,
      });
    });

    it("ignores top-level seed/* files with no subtarget", () => {
      expect(routeFile("seed/orphan.json", slug)).toBeNull();
    });
  });

  describe("default path preservation", () => {
    it("keeps unrecognized layouts under repo root", () => {
      expect(routeFile("misc/notes.md", slug)).toEqual({
        subdir: "misc",
        filename: "notes.md",
        substituteSlug: false,
      });
    });

    it("a top-level unrecognized file lands at repo root", () => {
      expect(routeFile("LICENSE", slug)).toEqual({
        subdir: "",
        filename: "LICENSE",
        substituteSlug: false,
      });
    });
  });

  describe("instructions/", () => {
    // PIN-6614 follow-up: per-topic instruction files seeded by the
    // plugin are Claude system files, not user content. They live
    // under `.openit/instructions/` (alongside `config.json`,
    // `workstation.json`, etc.) so they don't clutter the user-visible
    // file explorer next to `databases/`, `filestores/`, etc. The
    // CLAUDE.md index at the vault root links into this hidden dir.
    it("routes instructions/<file>.md to <repo>/.openit/instructions/<file>.md", () => {
      expect(routeFile("instructions/command-authoring.md", slug)).toEqual({
        subdir: ".openit/instructions",
        filename: "command-authoring.md",
        substituteSlug: false,
      });
    });

    it("routes every instructions/* topic file consistently", () => {
      const topics = [
        "vault-layout",
        "command-authoring",
        "knowledge-conventions",
        "tool-calling",
        "auto-vs-ask",
        "communication-style",
        "ui-side-channels",
        "commands-reference",
      ];
      for (const topic of topics) {
        const r = routeFile(`instructions/${topic}.md`, slug);
        expect(r).toEqual({
          subdir: ".openit/instructions",
          filename: `${topic}.md`,
          substituteSlug: false,
        });
      }
    });
  });

  describe("slug parameter", () => {
    it("ignores slug for schemas (output is slug-free)", () => {
      const r = routeFile("schemas/tickets._schema.json", "any-slug-here");
      expect(r?.subdir).toBe("databases/tickets");
    });

    it("ignores slug for agents (output is slug-free)", () => {
      const r = routeFile("agents/triage.template.json", "any-slug-here");
      expect(r?.filename).toBe("triage.json");
    });
  });
});

describe("syncSkillsToDisk — agent write-once gate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("skips writing agents/<name>.json when the file already exists on disk", async () => {
    const writeCalls: Array<Record<string, unknown>> = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "skills_fetch_bundled_manifest") {
        return JSON.stringify({
          version: "test-1",
          files: [{ path: "agents/triage.template.json" }],
        }) as never;
      }
      if (cmd === "skills_fetch_bundled_file") {
        return JSON.stringify({ name: "triage" }) as never;
      }
      if (cmd === "fs_read") {
        // Simulate the agent file already existing on disk so the
        // write-once gate fires.
        return "existing user-edited content" as never;
      }
      if (cmd === "entity_write_file") {
        writeCalls.push(args as Record<string, unknown>);
        return undefined as never;
      }
      return undefined as never;
    });

    await syncSkillsToDisk("/repo", null);

    const agentWrites = writeCalls.filter(
      (c) => c.subdir === "agents" && c.filename === "triage.json",
    );
    expect(agentWrites).toEqual([]);
  });

  it("preserves user-edited files inside agents/<folder>/* across plugin bumps", async () => {
    const writeCalls: Array<Record<string, unknown>> = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "skills_fetch_bundled_manifest") {
        return JSON.stringify({
          version: "test-2",
          files: [
            { path: "agents/triage/triage.template.json" },
            { path: "agents/triage/common.md" },
            { path: "agents/triage/cloud.md" },
            { path: "agents/triage/local.md" },
          ],
        }) as never;
      }
      if (cmd === "skills_fetch_bundled_file") {
        return "bundled" as never;
      }
      if (cmd === "fs_read") {
        // Every probe finds an existing file → gate fires for all four.
        return "existing" as never;
      }
      if (cmd === "entity_write_file") {
        writeCalls.push(args as Record<string, unknown>);
        return undefined as never;
      }
      return undefined as never;
    });

    await syncSkillsToDisk("/repo", null);

    const triageWrites = writeCalls.filter(
      (c) => typeof c.subdir === "string" && (c.subdir as string).startsWith("agents/"),
    );
    expect(triageWrites).toEqual([]);
  });

  it("writes agents/<name>.json when the file is missing", async () => {
    const writeCalls: Array<Record<string, unknown>> = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "skills_fetch_bundled_manifest") {
        return JSON.stringify({
          version: "test-1",
          files: [{ path: "agents/triage.template.json" }],
        }) as never;
      }
      if (cmd === "skills_fetch_bundled_file") {
        return JSON.stringify({ name: "triage" }) as never;
      }
      if (cmd === "fs_read") {
        // File missing → fileExistsOnDisk returns false → write fires.
        throw new Error("ENOENT");
      }
      if (cmd === "entity_write_file") {
        writeCalls.push(args as Record<string, unknown>);
        return undefined as never;
      }
      return undefined as never;
    });

    await syncSkillsToDisk("/repo", null);

    const agentWrites = writeCalls.filter(
      (c) => c.subdir === "agents" && c.filename === "triage.json",
    );
    expect(agentWrites).toHaveLength(1);
  });
});

describe("syncSkillsToDisk — seed-commands tombstone gate", () => {
  // The four cases the tombstone gate distinguishes:
  //
  //   prev sentinel | file on disk | expected action
  //   --------------|--------------|----------------
  //   null (first)  | missing      | WRITE (fresh install)
  //   has(name)     | present      | PRESERVE (write-once — existing behavior)
  //   has(name)     | missing      | SKIP (user deleted — the fix)
  //   !has(name)    | missing      | WRITE (newly-shipped bundled command)
  //
  // Plus: every successful sync must persist the current bundled-command
  // set to `.openit/synced-seed-commands.json` so the next sync has the
  // input it needs to do the diff above.

  const SENTINEL_PATH = "/repo/.openit/synced-seed-commands.json";
  const COMMAND_PATH = "/repo/filestores/commands/backup.md";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  type MockSetup = {
    /// What the sentinel file contains. `undefined` = file missing
    /// (first install). String = file present with this content.
    sentinel: string | undefined;
    /// Whether the command file exists on disk. `undefined` = missing.
    /// String = exists with this content.
    commandFile: string | undefined;
    /// Manifest entries — defaults to just seed/commands/backup.md.
    manifestFiles?: Array<{ path: string }>;
  };

  function setupMocks(setup: MockSetup) {
    const writeCalls: Array<Record<string, unknown>> = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "skills_fetch_bundled_manifest") {
        return JSON.stringify({
          version: "test-1",
          files: setup.manifestFiles ?? [{ path: "seed/commands/backup.md" }],
        }) as never;
      }
      if (cmd === "skills_fetch_bundled_file") {
        return "# bundled backup command\n" as never;
      }
      if (cmd === "fs_read") {
        const path = (args as { path: string }).path;
        if (path === SENTINEL_PATH) {
          if (setup.sentinel === undefined) throw new Error("ENOENT");
          return setup.sentinel as never;
        }
        if (path === COMMAND_PATH) {
          if (setup.commandFile === undefined) throw new Error("ENOENT");
          return setup.commandFile as never;
        }
        // Everything else (plugin-version sentinel, other probe paths) →
        // treat as missing so the rest of the sync doesn't accidentally
        // short-circuit on a stray "exists" answer.
        throw new Error("ENOENT");
      }
      if (cmd === "entity_write_file") {
        writeCalls.push(args as Record<string, unknown>);
        return undefined as never;
      }
      if (cmd === "git_commit_paths") {
        return undefined as never;
      }
      return undefined as never;
    });
    return writeCalls;
  }

  function commandWrites(calls: Array<Record<string, unknown>>) {
    return calls.filter(
      (c) => c.subdir === "filestores/commands" && c.filename === "backup.md",
    );
  }

  function sentinelWrites(calls: Array<Record<string, unknown>>) {
    return calls.filter(
      (c) => c.subdir === ".openit" && c.filename === "synced-seed-commands.json",
    );
  }

  it("first install — writes the bundled command (no prior sentinel)", async () => {
    const calls = setupMocks({ sentinel: undefined, commandFile: undefined });
    await syncSkillsToDisk("/repo", null);
    expect(commandWrites(calls)).toHaveLength(1);
  });

  it("steady state — preserves the existing user-edited file (write-once gate)", async () => {
    const calls = setupMocks({
      sentinel: JSON.stringify({ commands: ["backup"] }),
      commandFile: "# user-edited backup",
    });
    await syncSkillsToDisk("/repo", null);
    expect(commandWrites(calls)).toEqual([]);
  });

  it("respects user deletion — skip when sentinel knows the command but the file is gone", async () => {
    const calls = setupMocks({
      sentinel: JSON.stringify({ commands: ["backup"] }),
      commandFile: undefined,
    });
    await syncSkillsToDisk("/repo", null);
    expect(commandWrites(calls)).toEqual([]);
  });

  it("writes newly-shipped bundled commands the user has never seen", async () => {
    // Manifest now ships `onboard.md` in addition to `backup.md`. The
    // previous sentinel only mentions `backup`, so `onboard` is genuinely
    // new and must be written even though it's missing on disk.
    const writeCalls: Array<Record<string, unknown>> = [];
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "skills_fetch_bundled_manifest") {
        return JSON.stringify({
          version: "test-2",
          files: [
            { path: "seed/commands/backup.md" },
            { path: "seed/commands/onboard.md" },
          ],
        }) as never;
      }
      if (cmd === "skills_fetch_bundled_file") {
        return "# bundled\n" as never;
      }
      if (cmd === "fs_read") {
        const path = (args as { path: string }).path;
        if (path === SENTINEL_PATH) {
          return JSON.stringify({ commands: ["backup"] }) as never;
        }
        // Both `backup.md` and `onboard.md` are missing on disk.
        throw new Error("ENOENT");
      }
      if (cmd === "entity_write_file") {
        writeCalls.push(args as Record<string, unknown>);
        return undefined as never;
      }
      if (cmd === "git_commit_paths") {
        return undefined as never;
      }
      return undefined as never;
    });

    await syncSkillsToDisk("/repo", null);

    const backupWrites = writeCalls.filter(
      (c) => c.subdir === "filestores/commands" && c.filename === "backup.md",
    );
    const onboardWrites = writeCalls.filter(
      (c) => c.subdir === "filestores/commands" && c.filename === "onboard.md",
    );
    expect(backupWrites).toEqual([]); // tombstoned
    expect(onboardWrites).toHaveLength(1); // genuinely new
  });

  it("persists the current bundled-command set after each sync", async () => {
    const calls = setupMocks({
      sentinel: undefined,
      commandFile: undefined,
      manifestFiles: [
        { path: "seed/commands/backup.md" },
        { path: "seed/commands/onboard.md" },
      ],
    });
    await syncSkillsToDisk("/repo", null);
    const writes = sentinelWrites(calls);
    expect(writes).toHaveLength(1);
    const written = JSON.parse(writes[0].content as string) as { commands: string[] };
    expect(written.commands).toEqual(["backup", "onboard"]);
  });

  it("handles a malformed sentinel as 'no prior sync' rather than crashing", async () => {
    const calls = setupMocks({
      sentinel: "{ this is not valid json",
      commandFile: undefined,
    });
    await syncSkillsToDisk("/repo", null);
    // Malformed → readSyncedSeedCommands returns null → treated as first
    // install → write fires. (The alternative — treating malformed as
    // "empty set" — would also write here; both behaviours converge in
    // this specific case. The test guards against a crash, not a precise
    // recovery strategy.)
    expect(commandWrites(calls)).toHaveLength(1);
  });
});
