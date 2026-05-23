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
  scriptResolveInterpreter: vi.fn(),
}));
vi.mock("./skillsSync", () => ({
  fetchSkillsManifest: vi.fn(),
  fetchSkillFile: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { fsRead, scriptResolveInterpreter } from "./api";
import { fetchSkillsManifest, fetchSkillFile } from "./skillsSync";
import { rewriteShebangForSeed, seedIfEmpty, seedRoute } from "./seed";

const mockInvoke = vi.mocked(invoke);
const mockFsRead = vi.mocked(fsRead);
const mockResolveInterpreter = vi.mocked(scriptResolveInterpreter);
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
  // Default: interpreter unresolved → no shebang rewrite.
  mockResolveInterpreter.mockResolvedValue(null);
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

describe("rewriteShebangForSeed (PIN-6611)", () => {
  it("rewrites `#!/usr/bin/env node` to the resolved absolute path", async () => {
    mockResolveInterpreter.mockResolvedValueOnce("/opt/homebrew/bin/node");
    const out = await rewriteShebangForSeed(
      "hello-world.mjs",
      "#!/usr/bin/env node\nconsole.log('hi');\n",
    );
    expect(out.startsWith("#!/opt/homebrew/bin/node\n")).toBe(true);
    expect(out).toContain("console.log('hi');");
  });

  it("leaves the shebang alone when the interpreter doesn't resolve", async () => {
    mockResolveInterpreter.mockResolvedValueOnce(null);
    const src = "#!/usr/bin/env node\nconsole.log(1);\n";
    expect(await rewriteShebangForSeed("a.mjs", src)).toBe(src);
  });

  it("leaves the shebang alone when there's no `env`-style shebang", async () => {
    const src = "#!/opt/homebrew/bin/node\nconsole.log(1);\n";
    expect(await rewriteShebangForSeed("a.mjs", src)).toBe(src);
  });

  it("leaves the shebang alone when the extension doesn't match the interpreter", async () => {
    // .sh file with `env node` shebang — refuse to touch it.
    mockResolveInterpreter.mockResolvedValue("/opt/homebrew/bin/node");
    const src = "#!/usr/bin/env node\necho hi\n";
    expect(await rewriteShebangForSeed("weird.sh", src)).toBe(src);
  });

  it("rewrites .cjs and .js files too, not just .mjs", async () => {
    mockResolveInterpreter.mockResolvedValue("/usr/local/bin/node");
    const cjs = await rewriteShebangForSeed("a.cjs", "#!/usr/bin/env node\n//\n");
    const js = await rewriteShebangForSeed("a.js", "#!/usr/bin/env node\n//\n");
    expect(cjs.startsWith("#!/usr/local/bin/node\n")).toBe(true);
    expect(js.startsWith("#!/usr/local/bin/node\n")).toBe(true);
  });

  it("preserves CRLF line endings on the shebang line", async () => {
    mockResolveInterpreter.mockResolvedValueOnce("/usr/local/bin/node");
    const src = "#!/usr/bin/env node\r\nconsole.log(1);\r\n";
    const out = await rewriteShebangForSeed("a.mjs", src);
    expect(out.startsWith("#!/usr/local/bin/node\r\n")).toBe(true);
  });

  it("returns content unchanged when scriptResolveInterpreter throws", async () => {
    mockResolveInterpreter.mockRejectedValueOnce(new Error("ipc broke"));
    const src = "#!/usr/bin/env node\n//\n";
    expect(await rewriteShebangForSeed("a.mjs", src)).toBe(src);
  });

  it("handles `env -S node …` shebangs and preserves trailing args", async () => {
    mockResolveInterpreter.mockResolvedValueOnce("/opt/homebrew/bin/node");
    const src = "#!/usr/bin/env -S node --no-warnings\nconsole.log(1);\n";
    const out = await rewriteShebangForSeed("a.mjs", src);
    expect(out.startsWith("#!/opt/homebrew/bin/node --no-warnings\n")).toBe(true);
    expect(out).toContain("console.log(1);");
  });

  it("preserves trailing args without `-S` too", async () => {
    mockResolveInterpreter.mockResolvedValueOnce("/usr/local/bin/node");
    const src = "#!/usr/bin/env node --enable-source-maps\n//\n";
    const out = await rewriteShebangForSeed("a.mjs", src);
    expect(out.startsWith("#!/usr/local/bin/node --enable-source-maps\n")).toBe(true);
  });

  it("logs a [seed] warning when ext nominates an interpreter but the shebang names a different one", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // .mjs file but shebang says python3 — mismatch worth warning about.
      const src = "#!/usr/bin/env python3\nprint('hi')\n";
      const out = await rewriteShebangForSeed("oddball.mjs", src);
      expect(out).toBe(src);
      const warned = warnSpy.mock.calls.some(
        ([msg]) => typeof msg === "string" && msg.includes("[seed]") && msg.includes("oddball.mjs"),
      );
      expect(warned).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does NOT warn when the extension simply doesn't nominate a known interpreter (.sh, .rb, etc.)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const src = "#!/usr/bin/env bash\necho hi\n";
      const out = await rewriteShebangForSeed("setup.sh", src);
      expect(out).toBe(src);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("seedIfEmpty — script shebang rewrite (PIN-6611)", () => {
  const SCRIPTS_MANIFEST = {
    version: "v1",
    files: [
      { path: "seed/scripts/hello-world.mjs" },
      { path: "seed/tickets/sample-ticket-1.json" },
    ],
  };

  it("writes the rewritten shebang for `seed/scripts/*` when node is resolved", async () => {
    mockFetchSkillsManifest.mockResolvedValue(SCRIPTS_MANIFEST as any);
    mockFetchSkillFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".mjs")) {
        return "#!/usr/bin/env node\nconsole.log('seeded');\n";
      }
      return "{}";
    });
    mockResolveInterpreter.mockResolvedValue("/opt/homebrew/bin/node");

    await seedIfEmpty({ repo: "/repo" });

    const scriptWrite = mockInvoke.mock.calls.find(
      ([cmd, args]) =>
        cmd === "entity_write_file" &&
        (args as any).filename === "hello-world.mjs",
    );
    expect(scriptWrite).toBeDefined();
    const content = (scriptWrite![1] as any).content as string;
    expect(content.startsWith("#!/opt/homebrew/bin/node\n")).toBe(true);
  });

  it("doesn't rewrite shebangs for non-script seed files", async () => {
    mockFetchSkillsManifest.mockResolvedValue(SCRIPTS_MANIFEST as any);
    mockFetchSkillFile.mockResolvedValue('{"status":"open"}');
    mockResolveInterpreter.mockResolvedValue("/opt/homebrew/bin/node");

    await seedIfEmpty({ repo: "/repo" });

    const ticketWrite = mockInvoke.mock.calls.find(
      ([cmd, args]) =>
        cmd === "entity_write_file" &&
        (args as any).filename === "sample-ticket-1.json",
    );
    expect(ticketWrite).toBeDefined();
    expect((ticketWrite![1] as any).content).toBe('{"status":"open"}');
  });

  it("falls back to the unrewritten shebang when node isn't installed", async () => {
    mockFetchSkillsManifest.mockResolvedValue(SCRIPTS_MANIFEST as any);
    mockFetchSkillFile.mockImplementation(async (path: string) => {
      if (path.endsWith(".mjs")) {
        return "#!/usr/bin/env node\nconsole.log('seeded');\n";
      }
      return "{}";
    });
    mockResolveInterpreter.mockResolvedValue(null);

    await seedIfEmpty({ repo: "/repo" });

    const scriptWrite = mockInvoke.mock.calls.find(
      ([cmd, args]) =>
        cmd === "entity_write_file" &&
        (args as any).filename === "hello-world.mjs",
    );
    expect(scriptWrite).toBeDefined();
    const content = (scriptWrite![1] as any).content as string;
    expect(content.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });
});
