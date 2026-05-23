/**
 * seedIfEmpty gate logic. Per-file gate: every missing sample writes,
 * every existing sample skips. No per-folder "all or nothing" check —
 * re-clicking the CTA fills in deleted samples without clobbering user
 * content.
 *
 * The seed manifest no longer includes tickets or conversations
 * (PIN-6605 removed the bespoke ticket model). The fixtures here mirror
 * the actual manifest shape: people / knowledge / commands / scripts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("./api", () => ({
  fsRead: vi.fn(),
}));
vi.mock("./skillsSync", () => ({
  fetchSkillsManifest: vi.fn(),
  fetchSkillFile: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { fsRead } from "./api";
import { fetchSkillsManifest, fetchSkillFile } from "./skillsSync";
import { seedIfEmpty, seedRoute } from "./seed";

const mockInvoke = vi.mocked(invoke);
const mockFsRead = vi.mocked(fsRead);
const mockFetchSkillsManifest = vi.mocked(fetchSkillsManifest);
const mockFetchSkillFile = vi.mocked(fetchSkillFile);

const SAMPLE_MANIFEST = {
  version: "v1",
  files: [
    { path: "seed/people/sample-person-1.json" },
    { path: "seed/people/sample-person-2.json" },
    { path: "seed/knowledge/sample-article-1.md" },
    { path: "seed/commands/sample-command.md" },
    { path: "seed/scripts/sample-script.mjs" },
    { path: "seed/reports/sample-report.md" },
    { path: "skills/some-skill.md" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchSkillsManifest.mockResolvedValue(SAMPLE_MANIFEST as any);
  mockFetchSkillFile.mockResolvedValue("{}");
  mockInvoke.mockResolvedValue(undefined);
  // Default: nothing on disk yet.
  mockFsRead.mockRejectedValue(new Error("not found"));
});

describe("seedRoute", () => {
  it("routes seed/people/* → databases/people", () => {
    expect(seedRoute("seed/people/p1.json")).toEqual({
      subdir: "databases/people",
      filename: "p1.json",
    });
  });

  it("routes seed/knowledge/* → knowledge", () => {
    expect(seedRoute("seed/knowledge/article.md")).toEqual({
      subdir: "knowledge",
      filename: "article.md",
    });
  });

  it("routes seed/commands/* → filestores/commands", () => {
    expect(seedRoute("seed/commands/hello-world.md")).toEqual({
      subdir: "filestores/commands",
      filename: "hello-world.md",
    });
  });

  it("routes seed/scripts/* → filestores/scripts", () => {
    expect(seedRoute("seed/scripts/hello-world.mjs")).toEqual({
      subdir: "filestores/scripts",
      filename: "hello-world.mjs",
    });
  });

  it("routes seed/access/* → databases/access", () => {
    expect(seedRoute("seed/access/sample.json")).toEqual({
      subdir: "databases/access",
      filename: "sample.json",
    });
  });

  it("routes seed/assets/* → databases/assets", () => {
    expect(seedRoute("seed/assets/sample.json")).toEqual({
      subdir: "databases/assets",
      filename: "sample.json",
    });
  });

  it("routes seed/reports/* → reports", () => {
    expect(seedRoute("seed/reports/sample.md")).toEqual({
      subdir: "reports",
      filename: "sample.md",
    });
  });

  it("returns null for legacy ticket / conversation paths (no longer surfaced)", () => {
    expect(seedRoute("seed/tickets/sample.json")).toBeNull();
    expect(seedRoute("seed/conversations/T1/msg-aa01.json")).toBeNull();
  });

  it("returns null for non-seed paths", () => {
    expect(seedRoute("skills/some-skill.md")).toBeNull();
  });
});

describe("seedIfEmpty — per-file gate", () => {
  it("writes every sample when nothing is on disk", async () => {
    const res = await seedIfEmpty({ repo: "/repo" });
    // 2 people + 1 article + 1 command + 1 script + 1 report = 6
    expect(res.wrote).toBe(6);
    expect(res.skipped).toBe(0);
    const writeInvocations = mockInvoke.mock.calls.filter(
      ([cmd]) => cmd === "entity_write_file",
    );
    expect(writeInvocations).toHaveLength(6);
  });

  it("skips an individual sample that already exists on disk", async () => {
    mockFsRead.mockImplementation(async (path: string) => {
      if (path.endsWith("databases/people/sample-person-1.json")) return "{}";
      throw new Error("not found");
    });

    const res = await seedIfEmpty({ repo: "/repo" });
    expect(res.wrote).toBe(5);
    expect(res.skipped).toBe(1);
  });

  it("writes nothing when every sample is already on disk", async () => {
    mockFsRead.mockResolvedValue("{}");
    const res = await seedIfEmpty({ repo: "/repo" });
    expect(res.wrote).toBe(0);
    expect(res.skipped).toBe(6);
  });

  it("ignores manifest entries that aren't seed paths", async () => {
    // skills/some-skill.md is in the manifest but seedRoute returns
    // null for it; never written, never counted.
    const res = await seedIfEmpty({ repo: "/repo" });
    const writePaths = mockInvoke.mock.calls
      .filter(([cmd]) => cmd === "entity_write_file")
      .map(([, args]) => (args as any).filename);
    expect(writePaths).not.toContain("some-skill.md");
    expect(res.wrote + res.skipped).toBe(6);
  });
});
