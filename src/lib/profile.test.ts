import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./api", () => ({
  fsRead: vi.fn(),
  entityWriteFile: vi.fn(),
  globalUserName: vi.fn(),
  osFullName: vi.fn(),
}));

import { fsRead, entityWriteFile, globalUserName, osFullName } from "./api";
import {
  parseProfileName,
  readProfileName,
  suggestedName,
  upsertName,
  writeProfileName,
} from "./profile";

const mockFsRead = vi.mocked(fsRead);
const mockWrite = vi.mocked(entityWriteFile);
const mockGit = vi.mocked(globalUserName);
const mockOs = vi.mocked(osFullName);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseProfileName", () => {
  it("reads name from frontmatter (quoted)", () => {
    expect(parseProfileName(`---\nname: "Ada Lovelace"\nemail: "a@b.c"\n---\n\nbody`)).toBe(
      "Ada Lovelace",
    );
  });

  it("reads name from frontmatter (unquoted)", () => {
    expect(parseProfileName(`---\nname: Grace Hopper\n---\n`)).toBe("Grace Hopper");
  });

  it("returns null when there is no frontmatter", () => {
    expect(parseProfileName(`# Just a heading\nname: not in frontmatter`)).toBeNull();
  });

  it("returns null when name is absent or blank", () => {
    expect(parseProfileName(`---\nemail: "a@b.c"\n---\n`)).toBeNull();
    expect(parseProfileName(`---\nname: ""\n---\n`)).toBeNull();
  });
});

describe("readProfileName", () => {
  it("returns the parsed name when profile.md exists", async () => {
    mockFsRead.mockResolvedValue(`---\nname: "Ada"\n---\n`);
    expect(await readProfileName("/repo")).toBe("Ada");
    expect(mockFsRead).toHaveBeenCalledWith("/repo/profile.md");
  });

  it("returns null when profile.md is missing", async () => {
    mockFsRead.mockRejectedValue(new Error("No such file"));
    expect(await readProfileName("/repo")).toBeNull();
  });
});

describe("suggestedName", () => {
  it("prefers the OS full name", async () => {
    mockOs.mockResolvedValue("Ada Lovelace");
    mockGit.mockResolvedValue("ada-git");
    expect(await suggestedName()).toBe("Ada Lovelace");
    expect(mockGit).not.toHaveBeenCalled();
  });

  it("falls back to the git name when no OS name", async () => {
    mockOs.mockResolvedValue(null);
    mockGit.mockResolvedValue("Ada Git");
    expect(await suggestedName()).toBe("Ada Git");
  });

  it("returns empty string when neither is available", async () => {
    mockOs.mockResolvedValue(null);
    mockGit.mockResolvedValue(null);
    expect(await suggestedName()).toBe("");
  });
});

describe("upsertName", () => {
  it("inserts name into frontmatter that has none, preserving body + other fields", () => {
    const raw = `---\nemail: "a@b.c"\n---\n\n## Team\n- Acme, 80 people\n`;
    const out = upsertName(raw, "Ada");
    expect(parseProfileName(out)).toBe("Ada");
    expect(out).toContain(`email: "a@b.c"`); // other frontmatter kept
    expect(out).toContain("## Team\n- Acme, 80 people"); // body kept
  });

  it("replaces an existing name without touching the rest", () => {
    const raw = `---\nname: "Old Name"\nrole: "IT"\n---\n\nnotes here\n`;
    const out = upsertName(raw, "New Name");
    expect(parseProfileName(out)).toBe("New Name");
    expect(out).not.toContain("Old Name");
    expect(out).toContain(`role: "IT"`);
    expect(out).toContain("notes here");
  });

  it("prepends frontmatter when the file has none, keeping the body", () => {
    const raw = `## How they work\n- prefers short replies\n`;
    const out = upsertName(raw, "Ada");
    expect(parseProfileName(out)).toBe("Ada");
    expect(out).toContain("## How they work\n- prefers short replies");
  });
});

describe("writeProfileName", () => {
  it("seeds a fresh profile.md at the vault root when none exists", async () => {
    mockFsRead.mockRejectedValue(new Error("No such file"));
    await writeProfileName("/repo", "  Ada Lovelace  ");
    expect(mockWrite).toHaveBeenCalledTimes(1);
    const [repo, subdir, filename, content] = mockWrite.mock.calls[0];
    expect(repo).toBe("/repo");
    expect(subdir).toBe(""); // root
    expect(filename).toBe("profile.md");
    expect(parseProfileName(content)).toBe("Ada Lovelace"); // trimmed
  });

  it("escapes double quotes in the name", async () => {
    mockFsRead.mockRejectedValue(new Error("No such file"));
    await writeProfileName("/repo", 'Ada "Countess" Lovelace');
    const content = mockWrite.mock.calls[0][3];
    expect(content).toContain('name: "Ada \\"Countess\\" Lovelace"');
  });

  it("MERGES into an existing profile.md instead of clobbering its body", async () => {
    mockFsRead.mockResolvedValue(
      `---\nrole: "Head of IT"\n---\n\n## Team\n- Acme, 80 people; Okta SSO\n`,
    );
    await writeProfileName("/repo", "Ada Lovelace");
    const content = mockWrite.mock.calls[0][3];
    expect(parseProfileName(content)).toBe("Ada Lovelace");
    expect(content).toContain(`role: "Head of IT"`); // existing frontmatter survives
    expect(content).toContain("## Team\n- Acme, 80 people; Okta SSO"); // body survives
  });
});
