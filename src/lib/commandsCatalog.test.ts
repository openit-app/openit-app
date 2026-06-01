// Tests for the shared command catalog. The catalog is the single
// source of truth that backs both the Commands tile counter (Workbench)
// and the Commands viewer (SkillsStation). If these tests regress, the
// sidebar count and the visible list will drift apart again — the exact
// bug PIN-6610 fixed.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fsList: vi.fn(),
}));

import { fsList, type FileNode } from "./api";
import { countCommands, listCommands } from "./commandsCatalog";

const mockedFsList = vi.mocked(fsList);

beforeEach(() => {
  mockedFsList.mockReset();
});

function file(name: string, path: string): FileNode {
  return { name, path, is_dir: false };
}
function dir(name: string, path: string): FileNode {
  return { name, path, is_dir: true };
}

/// Wire `fsList(root)` to the right fixture per call. `.claude/skills/`
/// and `filestores/commands/` are called in parallel from the catalog,
/// so the test has to route by argument rather than rely on call order.
function routeFsList(map: Record<string, FileNode[] | Error>) {
  mockedFsList.mockImplementation(async (root: string) => {
    const v = map[root];
    if (v === undefined) throw new Error(`unexpected fsList(${root})`);
    if (v instanceof Error) throw v;
    return v;
  });
}

describe("commandsCatalog", () => {
  it("counts 3 commands given 3 .md files plus _history snapshots and a dotfile", async () => {
    // The ticket's load-bearing fixture: a real vault has top-level
    // commands sitting alongside `_history/<ts>.md` snapshots from the
    // "commands learn in place" pattern and the occasional dotfile.
    // fs_list returns them recursively; the catalog must yield 3.
    const repo = "/r";
    const customRoot = `${repo}/filestores/commands`;
    routeFsList({
      [`${repo}/.claude/skills`]: new Error("ENOENT"),
      [customRoot]: [
        file("aws-cost-dash.md", `${customRoot}/aws-cost-dash.md`),
        file("open-cves.md",     `${customRoot}/open-cves.md`),
        file("sync-repos.md",    `${customRoot}/sync-repos.md`),
        // _history/ snapshots — must be ignored (not direct children).
        dir("_history",          `${customRoot}/aws-cost-dash/_history`),
        file("1700000000.md",    `${customRoot}/aws-cost-dash/_history/1700000000.md`),
        file("1700000001.md",    `${customRoot}/aws-cost-dash/_history/1700000001.md`),
        file("1700000002.md",    `${customRoot}/open-cves/_history/1700000002.md`),
        file("1700000003.md",    `${customRoot}/open-cves/_history/1700000003.md`),
        file("1700000004.md",    `${customRoot}/sync-repos/_history/1700000004.md`),
        // Hidden dotfile — must be ignored.
        file(".DS_Store",        `${customRoot}/.DS_Store`),
      ],
    });

    expect(await countCommands(repo)).toBe(3);
    const refs = await listCommands(repo);
    expect(refs.map((r) => r.name)).toEqual([
      "aws-cost-dash",
      "open-cves",
      "sync-repos",
    ]);
    expect(refs.every((r) => r.source === "custom")).toBe(true);
  });

  it("deduplicates names that exist in both .claude/skills and filestores/commands", async () => {
    // The historical bug: the counter added system + custom without
    // dedup so a name in both buckets got counted twice. The viewer
    // dedupes. After PIN-6610 both follow the same rule.
    const repo = "/r";
    routeFsList({
      [`${repo}/.claude/skills`]: [
        dir("aws-cost-dash", `${repo}/.claude/skills/aws-cost-dash`),
        dir("open-cves",     `${repo}/.claude/skills/open-cves`),
        dir("sync-repos",    `${repo}/.claude/skills/sync-repos`),
        // Nested files under each skill dir — fs_list is recursive,
        // but only the top-level dir should count.
        file("SKILL.md",     `${repo}/.claude/skills/aws-cost-dash/SKILL.md`),
        file("SKILL.md",     `${repo}/.claude/skills/open-cves/SKILL.md`),
        file("SKILL.md",     `${repo}/.claude/skills/sync-repos/SKILL.md`),
      ],
      [`${repo}/filestores/commands`]: [
        file("aws-cost-dash.md", `${repo}/filestores/commands/aws-cost-dash.md`),
        file("open-cves.md",     `${repo}/filestores/commands/open-cves.md`),
        file("sync-repos.md",    `${repo}/filestores/commands/sync-repos.md`),
      ],
    });

    expect(await countCommands(repo)).toBe(3);
    const refs = await listCommands(repo);
    // System wins on collisions.
    expect(refs.every((r) => r.source === "system")).toBe(true);
  });

  it("excludes .server.<ext> sidecar files from filestores/commands", async () => {
    const repo = "/r";
    routeFsList({
      [`${repo}/.claude/skills`]: new Error("ENOENT"),
      [`${repo}/filestores/commands`]: [
        file("backup.md",        `${repo}/filestores/commands/backup.md`),
        file("backup.server.md", `${repo}/filestores/commands/backup.server.md`),
        file("backup.server.json", `${repo}/filestores/commands/backup.server.json`),
      ],
    });

    expect(await countCommands(repo)).toBe(1);
  });

  it("excludes non-.md files from filestores/commands", async () => {
    const repo = "/r";
    routeFsList({
      [`${repo}/.claude/skills`]: new Error("ENOENT"),
      [`${repo}/filestores/commands`]: [
        file("backup.md",   `${repo}/filestores/commands/backup.md`),
        file("README.txt",  `${repo}/filestores/commands/README.txt`),
        file("config.json", `${repo}/filestores/commands/config.json`),
      ],
    });

    expect(await countCommands(repo)).toBe(1);
  });

  it("returns 0 when neither source exists", async () => {
    const repo = "/r";
    routeFsList({
      [`${repo}/.claude/skills`]: new Error("ENOENT"),
      [`${repo}/filestores/commands`]: new Error("ENOENT"),
    });

    expect(await countCommands(repo)).toBe(0);
    expect(await listCommands(repo)).toEqual([]);
  });

  it("orders system commands before custom commands", async () => {
    const repo = "/r";
    routeFsList({
      [`${repo}/.claude/skills`]: [
        dir("zeta", `${repo}/.claude/skills/zeta`),
        file("SKILL.md", `${repo}/.claude/skills/zeta/SKILL.md`),
      ],
      [`${repo}/filestores/commands`]: [
        file("alpha.md", `${repo}/filestores/commands/alpha.md`),
      ],
    });

    const refs = await listCommands(repo);
    expect(refs.map((r) => r.name)).toEqual(["zeta", "alpha"]);
  });

  it("excludes an orphaned skill dir with no SKILL.md (delete leftover)", async () => {
    // Deleting a command's SKILL.md leaves an empty `.claude/skills/<name>/`
    // directory behind. It must NOT show up as a ghost command (the
    // bug: it listed and opened to "this file no longer exists").
    const repo = "/r";
    routeFsList({
      [`${repo}/.claude/skills`]: [
        dir("live", `${repo}/.claude/skills/live`),
        file("SKILL.md", `${repo}/.claude/skills/live/SKILL.md`),
        // `ghost` dir exists but its SKILL.md was deleted — orphan.
        dir("ghost", `${repo}/.claude/skills/ghost`),
      ],
      [`${repo}/filestores/commands`]: new Error("ENOENT"),
    });

    expect(await countCommands(repo)).toBe(1);
    const refs = await listCommands(repo);
    expect(refs.map((r) => r.name)).toEqual(["live"]);
  });

  it("surfaces the editable custom copy when the mirror SKILL.md is gone", async () => {
    // If a command's `.claude/skills/<name>/SKILL.md` mirror was deleted
    // but the source `filestores/commands/<name>.md` still exists, the
    // command should still appear — sourced from the editable custom copy,
    // not the orphaned mirror dir.
    const repo = "/r";
    routeFsList({
      [`${repo}/.claude/skills`]: [
        dir("backup", `${repo}/.claude/skills/backup`),
      ],
      [`${repo}/filestores/commands`]: [
        file("backup.md", `${repo}/filestores/commands/backup.md`),
      ],
    });

    const refs = await listCommands(repo);
    expect(refs.map((r) => r.name)).toEqual(["backup"]);
    expect(refs[0].source).toBe("custom");
    expect(refs[0].path).toBe(`${repo}/filestores/commands/backup.md`);
  });
});
