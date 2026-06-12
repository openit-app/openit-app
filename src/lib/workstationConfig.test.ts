// Tests for the workstation config loader / reset / merge logic. The
// 2026-05-24 "primitives-only" reorg made the load path the single
// place that:
//   (a) seeds the default 8-primitive main set on fresh vaults,
//   (b) resets stale legacy configs to the new layout, and
//   (c) preserves user-pinned MORE entries while stripping legacy
//       auto-discovered ones.
// These tests pin that behaviour so future tweaks don't silently leak
// non-primitive tiles back into the default main row.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fsRead: vi.fn(),
  fsList: vi.fn(),
  entityWriteFile: vi.fn(),
}));

import { fsRead, fsList, entityWriteFile } from "./api";
import {
  DEFAULT_WORKSTATION_CONFIG,
  PRIMITIVE_MAIN_RELS,
  PRIMITIVE_MORE_RELS,
  PRIMITIVE_RELS,
  isPrimitiveRel,
  loadWorkstationConfig,
  mergeConfigWithDiscovery,
  type DiscoveredTile,
  type WorkstationConfig,
} from "./workstationConfig";

const mockedFsRead = vi.mocked(fsRead);
const mockedEntityWriteFile = vi.mocked(entityWriteFile);

beforeEach(() => {
  mockedFsRead.mockReset();
  mockedEntityWriteFile.mockReset();
  mockedEntityWriteFile.mockResolvedValue(undefined);
});

describe("default config", () => {
  it("ships 3 primitives in main and the other 5 in more by default", () => {
    expect(DEFAULT_WORKSTATION_CONFIG.main.map((t) => t.rel)).toEqual([
      "tasks",
      "knowledge",
      "filestores/commands",
    ]);
    expect(DEFAULT_WORKSTATION_CONFIG.more.map((t) => t.rel)).toEqual([
      "reports",
      "filestores",
      "databases",
      "tools",
      "traces",
    ]);
    // Default-more primitives ship as userPinned so they survive resets.
    expect(DEFAULT_WORKSTATION_CONFIG.more.every((t) => t.userPinned === true)).toBe(true);
  });

  it("PRIMITIVE_RELS is the union of main + more primitives", () => {
    expect([...PRIMITIVE_RELS]).toEqual([
      ...DEFAULT_WORKSTATION_CONFIG.main.map((t) => t.rel),
      ...DEFAULT_WORKSTATION_CONFIG.more.map((t) => t.rel),
    ]);
  });

  it("isPrimitiveRel rejects sub-store rels", () => {
    expect(isPrimitiveRel("tasks")).toBe(true);
    expect(isPrimitiveRel("filestores/commands")).toBe(true);
    expect(isPrimitiveRel("databases/people")).toBe(false);
    expect(isPrimitiveRel("filestores/library")).toBe(false);
  });
});

describe("loadWorkstationConfig — fresh vault", () => {
  it("returns the default config when no file exists", async () => {
    mockedFsRead.mockRejectedValue(new Error("ENOENT"));
    const cfg = await loadWorkstationConfig("/repo");
    expect(cfg).toEqual(DEFAULT_WORKSTATION_CONFIG);
    expect(mockedEntityWriteFile).not.toHaveBeenCalled();
  });
});

describe("loadWorkstationConfig — reset triggers", () => {
  it("wipes main when it contains non-primitive tiles (legacy auto-derived shape)", async () => {
    const legacy: WorkstationConfig = {
      main: [
        { rel: "tasks" },
        { rel: "knowledge" },
        { rel: "filestores/commands" },
        { rel: "databases/people" }, // ← non-primitive, triggers reset
      ],
      more: [],
    };
    mockedFsRead.mockResolvedValue(JSON.stringify(legacy));

    const cfg = await loadWorkstationConfig("/repo");
    expect(cfg.main.map((t) => t.rel)).toEqual(
      DEFAULT_WORKSTATION_CONFIG.main.map((t) => t.rel),
    );
    // Persisted so subsequent loads skip the migration.
    expect(mockedEntityWriteFile).toHaveBeenCalledTimes(1);
  });

  it("appends missing main primitives without wiping the existing order", async () => {
    // User had a subset of primitives (no `tools`, no `traces`). They
    // didn't add anything weird, just lost a few — fill the gaps while
    // preserving their order.
    // User had a subset of MAIN primitives (missing `filestores/commands`).
    const partial: WorkstationConfig = {
      main: [
        { rel: "tasks" },
        { rel: "knowledge" },
      ],
      more: [],
    };
    mockedFsRead.mockResolvedValue(JSON.stringify(partial));

    const cfg = await loadWorkstationConfig("/repo");
    expect(cfg.main.map((t) => t.rel)).toEqual([
      "tasks",
      "knowledge",
      // appended in PRIMITIVE_MAIN_RELS order
      "filestores/commands",
    ]);
    expect(mockedEntityWriteFile).toHaveBeenCalledTimes(1);
  });

  it("strips MORE entries that lack userPinned", async () => {
    const legacy: WorkstationConfig = {
      main: PRIMITIVE_MAIN_RELS.map((rel) => ({ rel })),
      more: [
        ...PRIMITIVE_MORE_RELS.map((rel) => ({ rel, userPinned: true })),
        { rel: "databases/people" }, // legacy auto-discovered (will be stripped)
        { rel: "databases/access" }, // legacy auto-discovered (will be stripped)
        { rel: "filestores/library", userPinned: true }, // explicit pin survives
      ],
    };
    mockedFsRead.mockResolvedValue(JSON.stringify(legacy));

    const cfg = await loadWorkstationConfig("/repo");
    expect(cfg.more.map((t) => t.rel)).toEqual([
      ...PRIMITIVE_MORE_RELS,
      "filestores/library",
    ]);
    expect(mockedEntityWriteFile).toHaveBeenCalledTimes(1);
  });

  it("leaves a clean 3-main / 5-more primitives config alone", async () => {
    const clean: WorkstationConfig = {
      main: PRIMITIVE_MAIN_RELS.map((rel) => ({ rel })),
      more: [
        ...PRIMITIVE_MORE_RELS.map((rel) => ({ rel, userPinned: true })),
        { rel: "databases/people", userPinned: true },
      ],
    };
    mockedFsRead.mockResolvedValue(JSON.stringify(clean));

    const cfg = await loadWorkstationConfig("/repo");
    expect(cfg).toEqual(clean);
    expect(mockedEntityWriteFile).not.toHaveBeenCalled();
  });

  it("preserves user customisations (icon/label/tone) on primitives in main", async () => {
    const customised: WorkstationConfig = {
      main: PRIMITIVE_MAIN_RELS.map((rel) =>
        rel === "tasks" ? { rel, label: "My Tasks", icon: "checklist" } : { rel },
      ),
      more: PRIMITIVE_MORE_RELS.map((rel) => ({ rel, userPinned: true })),
    };
    mockedFsRead.mockResolvedValue(JSON.stringify(customised));

    const cfg = await loadWorkstationConfig("/repo");
    expect(cfg.main.find((t) => t.rel === "tasks")?.label).toBe("My Tasks");
    expect(mockedEntityWriteFile).not.toHaveBeenCalled();
  });

  it("preserves a user-pinned filestore sub-store promoted to MAIN across reload (PIN-7012)", async () => {
    // Repro for PIN-7012 "tile flips on then disappears": the user pins
    // a filestore sub-store via right-click → "Add to workstation" (lands
    // in MORE with userPinned:true), then uses "move to main" to promote
    // it. That leaves a non-primitive tile in MAIN. On the next config
    // reload the migration must NOT wipe it.
    const promoted: WorkstationConfig = {
      main: [
        ...PRIMITIVE_MAIN_RELS.map((r) => ({ rel: r })),
        { rel: "filestores/library", userPinned: true }, // ← user-pinned sub-store promoted to MAIN
      ],
      more: PRIMITIVE_MORE_RELS.map((r) => ({ rel: r, userPinned: true })),
    };
    mockedFsRead.mockResolvedValue(JSON.stringify(promoted));

    const cfg = await loadWorkstationConfig("/repo");

    // The promoted filestore must survive the reload — not vanish.
    expect(cfg.main.map((t) => t.rel)).toContain("filestores/library");
    // The other primitives must still be present (main must not be wiped).
    for (const rel of PRIMITIVE_MAIN_RELS) {
      expect(cfg.main.map((t) => t.rel)).toContain(rel);
    }
    // userPinned flag preserved on the promoted tile.
    expect(cfg.main.find((t) => t.rel === "filestores/library")?.userPinned).toBe(true);
  });

  it("promotes MORE-default primitives to MAIN and persists across reload", async () => {
    // Parametrized test over all five PRIMITIVE_MORE_RELS to ensure
    // the fix works for all affected primitives and prevent future
    // regressions where similar logic could target a different rel.
    for (const rel of PRIMITIVE_MORE_RELS) {
      // Reset mocks between iterations
      mockedFsRead.mockReset();
      mockedEntityWriteFile.mockReset();
      mockedEntityWriteFile.mockResolvedValue(undefined);

      // Simulate user promoting a MORE-default primitive to MAIN
      const promoted: WorkstationConfig = {
        main: [
          ...PRIMITIVE_MAIN_RELS.map((r) => ({ rel: r })),
          { rel }, // ← user promoted this primative from MORE to MAIN
        ],
        more: PRIMITIVE_MORE_RELS.filter((r) => r !== rel).map((r) => ({ rel: r, userPinned: true })),
      };
      mockedFsRead.mockResolvedValue(JSON.stringify(promoted));

      // Load should NOT revert the user's promotion (this was the bug)
      const cfg = await loadWorkstationConfig("/repo");

      // Assert the promoted tile is still in MAIN after reload
      expect(cfg.main.map((t) => t.rel)).toContain(rel);

      // Assert it's NOT in MORE (promotion is complete)
      expect(cfg.more.map((t) => t.rel)).not.toContain(rel);

      // Assert no re-writing occurred (config was valid, no migration needed)
      expect(mockedEntityWriteFile).not.toHaveBeenCalled();
    }
  });
});

describe("mergeConfigWithDiscovery", () => {
  const discovered: DiscoveredTile[] = [
    { rel: "tasks",              label: "Tasks",     defaultIcon: "checklist", defaultTone: "accent",  countMode: "files" },
    { rel: "knowledge",          label: "Knowledge", defaultIcon: "knowledge", defaultTone: "ochre",   countMode: "files" },
    { rel: "filestores/commands", label: "Commands", defaultIcon: "commands",  defaultTone: "accent",  countMode: "files" },
    { rel: "reports",            label: "Reports",   defaultIcon: "reports",   defaultTone: "link",    countMode: "files" },
    { rel: "filestores",         label: "Filestores", defaultIcon: "folder",   defaultTone: "neutral", countMode: "dirs"  },
    { rel: "databases",          label: "Databases", defaultIcon: "database",  defaultTone: "link",    countMode: "dirs"  },
    { rel: "tools",              label: "Tools",     defaultIcon: "tools",     defaultTone: "accent",  countMode: "custom" },
    { rel: "traces",             label: "Traces",    defaultIcon: "traces",    defaultTone: "neutral", countMode: "dirs"  },
    // Discovered sub-stores — should NOT auto-appear in MORE.
    { rel: "databases/people",   label: "People",    defaultIcon: "person",    defaultTone: "sage",    countMode: "json-rows" },
    { rel: "filestores/library", label: "Library",   defaultIcon: "folder",    defaultTone: "neutral", countMode: "files" },
  ];

  it("does NOT auto-append discovered tiles to more", () => {
    const cfg: WorkstationConfig = {
      main: PRIMITIVE_RELS.map((rel) => ({ rel })),
      more: [],
    };
    const { main, more } = mergeConfigWithDiscovery(cfg, discovered);
    expect(main.map((t) => t.rel)).toEqual([...PRIMITIVE_RELS]);
    // databases/people and filestores/library should NOT have been
    // auto-appended to MORE.
    expect(more).toEqual([]);
  });

  it("resolves explicitly pinned MORE entries with full metadata", () => {
    const cfg: WorkstationConfig = {
      main: PRIMITIVE_RELS.map((rel) => ({ rel })),
      more: [{ rel: "databases/people", userPinned: true }],
    };
    const { more } = mergeConfigWithDiscovery(cfg, discovered);
    expect(more).toHaveLength(1);
    expect(more[0].rel).toBe("databases/people");
    expect(more[0].label).toBe("People");
    expect(more[0].icon).toBe("person");
  });

  it("silently drops tiles whose disk path no longer exists", () => {
    const cfg: WorkstationConfig = {
      main: PRIMITIVE_RELS.map((rel) => ({ rel })),
      more: [{ rel: "databases/ghost", userPinned: true }],
    };
    const { more } = mergeConfigWithDiscovery(cfg, discovered);
    expect(more).toEqual([]);
  });
});
