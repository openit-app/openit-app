import { describe, it, expect } from "vitest";
import {
  extractDescription,
  mergeCommandEntries,
  renderDraftBoilerplate,
} from "./SkillsStation";

type Entry = ReturnType<typeof mergeCommandEntries>[number];

const system = (name: string, dir = `/repo/.claude/skills/${name}`): Entry => ({
  name,
  description: `system ${name}`,
  path: `${dir}/SKILL.md`,
  origin: "system",
});

const custom = (name: string, dir = `/repo/filestores/commands`): Entry => ({
  name,
  description: `custom ${name}`,
  path: `${dir}/${name}.md`,
  origin: "custom",
});

describe("mergeCommandEntries — Lisa scenario", () => {
  it("shows every command (no fold), system group first then custom", () => {
    const merged = mergeCommandEntries(
      [system("onboard"), system("offboard")],
      [custom("aws-cost-dash"), custom("open-cves"), custom("sync-repos")],
    );
    // Five distinct commands — system alpha first, then custom alpha.
    expect(merged.map((e) => e.name)).toEqual([
      "offboard",
      "onboard",
      "aws-cost-dash",
      "open-cves",
      "sync-repos",
    ]);
  });

  it("matches Ben's 6 → 3 bug repro: all 6 visible after fix", () => {
    // Ben's report: tile said 6, list showed 3 with 'Show 3 more'.
    // After fix, the visible list must have all 6.
    const systemHalf = [system("onboard"), system("offboard"), system("backup")];
    const customHalf = [
      custom("aws-cost-dash"),
      custom("open-cves"),
      custom("sync-repos"),
    ];
    const merged = mergeCommandEntries(systemHalf, customHalf);
    expect(merged).toHaveLength(6);
  });
});

describe("mergeCommandEntries — dedupe", () => {
  it("prefers the custom entry when a slug exists in both origins", () => {
    // .claude/skills/onboard exists (system mirror) AND
    // filestores/commands/onboard.md exists (admin override). The
    // editable source-of-truth is the filestore copy; the mirror is
    // overwritten on every sync. So the merged entry must point at
    // the filestore path.
    const merged = mergeCommandEntries(
      [system("onboard")],
      [custom("onboard")],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].origin).toBe("custom");
    expect(merged[0].path).toBe("/repo/filestores/commands/onboard.md");
  });

  it("keeps system-only commands when no custom override exists", () => {
    const merged = mergeCommandEntries(
      [system("onboard")],
      [custom("aws-cost-dash")],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.name === "onboard")?.origin).toBe("system");
    expect(merged.find((e) => e.name === "aws-cost-dash")?.origin).toBe(
      "custom",
    );
  });
});

describe("mergeCommandEntries — ordering", () => {
  it("sorts alphabetically within each group, system group first", () => {
    const merged = mergeCommandEntries(
      [system("zeta"), system("alpha")],
      [custom("beta"), custom("yankee")],
    );
    // system: alpha, zeta — then custom: beta, yankee.
    expect(merged.map((e) => e.name)).toEqual([
      "alpha",
      "zeta",
      "beta",
      "yankee",
    ]);
  });

  it("moves a system command overridden by a custom file into the custom group", () => {
    // `onboard` exists as both a system mirror and a filestore source.
    // The custom version wins, and because its origin is "custom" it
    // appears in the custom group, not where the system "onboard"
    // would have sorted.
    const merged = mergeCommandEntries(
      [system("alpha"), system("onboard"), system("zeta")],
      [custom("beta"), custom("onboard")],
    );
    expect(merged.map((e) => e.name)).toEqual([
      "alpha",
      "zeta",
      "beta",
      "onboard",
    ]);
    expect(merged.find((e) => e.name === "onboard")?.origin).toBe("custom");
  });

  it("returns an empty list when no commands exist", () => {
    expect(mergeCommandEntries([], [])).toEqual([]);
  });
});

describe("renderDraftBoilerplate", () => {
  it("includes status: draft and the user's intent in the description", () => {
    const body = renderDraftBoilerplate(
      "weekly-report",
      "Summarise this week's open tickets by status.",
    );
    expect(body).toContain("status: draft");
    // YAML single-quoted scalar with `'` doubled.
    expect(body).toContain(
      "description: 'Summarise this week''s open tickets by status.'",
    );
    expect(body).toContain("# /weekly-report");
    expect(body).toContain("Draft.");
  });

  it("uses single-quoted YAML so double quotes round-trip unchanged", () => {
    const body = renderDraftBoilerplate(
      "quoter",
      'Find rows where status = "open".',
    );
    expect(body).toContain(
      `description: 'Find rows where status = "open".'`,
    );
  });

  it("does not escape Windows-style backslashes in the description", () => {
    const body = renderDraftBoilerplate(
      "winpath",
      "Back up everything in C:\\Users\\admin\\Documents.",
    );
    // Single-quoted YAML — backslashes are literal, no escaping needed.
    expect(body).toContain(
      "description: 'Back up everything in C:\\Users\\admin\\Documents.'",
    );
  });

  it("collapses newlines in the intent so the YAML description stays on one line", () => {
    const body = renderDraftBoilerplate(
      "multiline",
      "First line.\nSecond line.\n\nThird line.",
    );
    expect(body).toContain(
      "description: 'First line. Second line. Third line.'",
    );
  });

  it("includes the slug in the history path reminder", () => {
    const body = renderDraftBoilerplate("foo", "do the foo thing");
    expect(body).toContain("filestores/commands/foo/_history/<ms>.md");
  });
});

describe("renderDraftBoilerplate ↔ extractDescription round-trip", () => {
  // BugBot finding: doubled apostrophes were leaking into the
  // displayed description because we YAML-escaped `'` → `''` in the
  // boilerplate but extractDescription only stripped outer quotes.
  // The round-trip must yield back exactly the admin's intent.
  it("round-trips an intent containing an apostrophe", () => {
    const intent = "Summarise this week's open tickets.";
    const body = renderDraftBoilerplate("weekly", intent);
    expect(extractDescription(body)).toBe(intent);
  });

  it("round-trips an intent containing double quotes", () => {
    const intent = 'Find rows where status = "open".';
    const body = renderDraftBoilerplate("quoter", intent);
    expect(extractDescription(body)).toBe(intent);
  });

  it("round-trips a backslash-heavy Windows path", () => {
    const intent = "Back up C:\\Users\\admin\\Documents nightly.";
    const body = renderDraftBoilerplate("winpath", intent);
    expect(extractDescription(body)).toBe(intent);
  });

  it("round-trips multi-line intent (collapsed to single line)", () => {
    const body = renderDraftBoilerplate(
      "multi",
      "First line.\nSecond line.\nThird.",
    );
    expect(extractDescription(body)).toBe("First line. Second line. Third.");
  });
});

describe("extractDescription — quoted YAML forms", () => {
  it("unescapes doubled apostrophes in single-quoted YAML", () => {
    const fm = "---\ndescription: 'week''s data'\nstatus: draft\n---\n";
    expect(extractDescription(fm)).toBe("week's data");
  });

  it("unescapes backslash and double-quote in double-quoted YAML", () => {
    const fm = '---\ndescription: "path\\\\to\\"thing"\n---\n';
    expect(extractDescription(fm)).toBe('path\\to"thing');
  });

  it("returns unquoted YAML values verbatim", () => {
    const fm = "---\ndescription: plain text value\n---\n";
    expect(extractDescription(fm)).toBe("plain text value");
  });
});
