// PIN-6691 — TODAY hero card rendering. Pins the three-pill layout
// when there's open work, the "No todos!" empty state when not, and
// the click → onOpen(tasks) contract. Mocks the api/tasks/workstation
// layers so the test boots without a real Tauri runtime.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../lib/api", () => ({
  fsList: vi.fn(async () => []),
  fsRead: vi.fn(async () => {
    throw new Error("no highlight.json");
  }),
  entityRemoveDir: vi.fn(),
  entityWriteFile: vi.fn(async () => undefined),
  listInstalledMcps: vi.fn(async () => []),
}));

vi.mock("../lib/toolsInstall", () => ({
  listInstalled: vi.fn(async () => new Set<string>()),
}));

vi.mock("../lib/commandsCatalog", () => ({
  countCommands: vi.fn(async () => 0),
}));

vi.mock("../lib/workstationConfig", () => ({
  loadWorkstationConfig: vi.fn(async () => ({ main: [], more: [] })),
  saveWorkstationConfig: vi.fn(),
  discoverTiles: vi.fn(async () => ({ structured: [], unstructured: [] })),
  mergeConfigWithDiscovery: vi.fn(() => ({ main: [], more: [] })),
}));

// Stable seed for mergeConfigWithDiscovery — individual tests can
// override before render.
import {
  loadWorkstationConfig,
  saveWorkstationConfig,
  mergeConfigWithDiscovery,
} from "../lib/workstationConfig";
const mockedMerge = vi.mocked(mergeConfigWithDiscovery);
const mockedLoadCfg = vi.mocked(loadWorkstationConfig);
const mockedSaveCfg = vi.mocked(saveWorkstationConfig);

// The REAL load/migration logic (un-mocked) — used by the PIN-7012
// promote-path regression test to verify what `promote` persists
// survives an actual config reload.
import { fsRead as mockedFsReadFn } from "../lib/api";
const realLoadWorkstationConfig =
  await vi.importActual<typeof import("../lib/workstationConfig")>(
    "../lib/workstationConfig",
  ).then((m) => m.loadWorkstationConfig);

vi.mock("../Toast", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

// Mock the viewers barrel — the production export pulls in
// react-pdf via PdfViewer, which requires DOMMatrix in the test
// environment. We only need `confirmDelete` for the Workbench
// surface, and our hero tests don't exercise it.
vi.mock("./viewers", () => ({
  confirmDelete: vi.fn(async () => false),
}));

// IconPicker pulls in heavy icon assets that aren't needed here.
vi.mock("./IconPicker", () => ({
  IconPicker: () => null,
}));

vi.mock("../lib/tasks", () => ({
  listTasks: vi.fn(),
  tallyTasksToday: vi.fn(),
  // Re-export the types as runtime no-ops so the import line in
  // Workbench.tsx resolves under the mock.
}));

vi.mock("../lib/taskStages", () => ({
  loadStages: vi.fn(async () => ["Todo", "In Progress", "Complete"]),
}));

import { listTasks, tallyTasksToday } from "../lib/tasks";
import { loadStages } from "../lib/taskStages";
import { Workbench } from "./Workbench";

const mockedListTasks = vi.mocked(listTasks);
const mockedTally = vi.mocked(tallyTasksToday);
const mockedStages = vi.mocked(loadStages);

beforeEach(() => {
  mockedListTasks.mockReset();
  mockedTally.mockReset();
  mockedStages.mockReset();
  mockedListTasks.mockResolvedValue([]);
  mockedStages.mockResolvedValue(["Todo", "In Progress", "Complete"]);
  // Restore the workstation-config mock defaults so per-test overrides
  // (e.g. the PIN-7012 promote test) don't leak into other tests.
  mockedLoadCfg.mockReset();
  mockedSaveCfg.mockReset();
  mockedMerge.mockReset();
  mockedLoadCfg.mockResolvedValue({ main: [], more: [] });
  mockedSaveCfg.mockResolvedValue(undefined);
  mockedMerge.mockReturnValue({ main: [], more: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderAndWait(props: Parameters<typeof Workbench>[0]) {
  await act(async () => {
    render(<Workbench {...props} />);
  });
}

describe("Workbench TODAY hero (PIN-6691)", () => {
  it("renders the three-pill layout with the tallied counts when todos > 0", async () => {
    mockedTally.mockReturnValue({ todos: 3, inProgress: 2, completeToday: 5 });

    await renderAndWait({
      repo: "/r",
      fsTick: 0,
      onOpen: vi.fn(),
      onShowFiles: vi.fn(),
    });

    expect(screen.getByText("Todos")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("Complete")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.queryByText("No todos!")).toBeNull();
  });

  it("renders 'No todos!' when the todo count is 0", async () => {
    mockedTally.mockReturnValue({ todos: 0, inProgress: 1, completeToday: 4 });

    await renderAndWait({
      repo: "/r",
      fsTick: 0,
      onOpen: vi.fn(),
      onShowFiles: vi.fn(),
    });

    expect(screen.getByText("No todos!")).toBeTruthy();
    // Other pill labels are hidden in the empty-state branch.
    expect(screen.queryByText("In progress")).toBeNull();
    expect(screen.queryByText("Complete")).toBeNull();
  });

  it("clicking the hero opens the tasks station", async () => {
    mockedTally.mockReturnValue({ todos: 2, inProgress: 0, completeToday: 0 });
    const onOpen = vi.fn();

    await renderAndWait({
      repo: "/r",
      fsTick: 0,
      onOpen,
      onShowFiles: vi.fn(),
    });

    const hero = screen.getByRole("button", { name: /open task list/i });
    fireEvent.click(hero);
    expect(onOpen).toHaveBeenCalledWith("/r/tasks");
  });

  it("renders zeros (empty-state) when repo is null", async () => {
    // The effect short-circuits on !repo and resets taskCounts to
    // zeros; the hero must still render in its empty state.
    await renderAndWait({
      repo: null,
      fsTick: 0,
      onOpen: vi.fn(),
      onShowFiles: vi.fn(),
    });

    expect(screen.getByText("No todos!")).toBeTruthy();
    // tallyTasksToday is NOT called when there's no repo — the effect
    // short-circuits before listTasks.
    expect(mockedTally).not.toHaveBeenCalled();
  });

  it("filters the 'tasks' primitive tile out of the workbench grid", async () => {
    // PIN-6691: the hero supersedes the tasks tile entirely. Having
    // both visible was a customer-reported duplicate. Verifies the
    // filter that excludes rel === 'tasks' from mainTiles + moreTiles.
    mockedTally.mockReturnValue({ todos: 0, inProgress: 0, completeToday: 0 });
    mockedMerge.mockReturnValueOnce({
      main: [
        { rel: "tasks", label: "Tasks", tone: "ember", icon: "tasks" } as never,
        { rel: "knowledge", label: "Knowledge", tone: "ink", icon: "kb" } as never,
      ],
      more: [],
    });
    await renderAndWait({
      repo: "/r",
      fsTick: 0,
      onOpen: vi.fn(),
      onShowFiles: vi.fn(),
    });

    // The Knowledge tile renders…
    expect(screen.getByText("Knowledge")).toBeTruthy();
    // …but the Tasks tile is filtered out.
    expect(screen.queryByText("Tasks")).toBeNull();
  });
});

describe("Workbench promote → reload (PIN-7012)", () => {
  it("an auto-discovered sub-store promoted straight to MAIN survives a real config reload", async () => {
    // The other half of PIN-7012 "flips on then disappears". A sub-store
    // can be rendered in the MORE grid (resolved moreTiles) WITHOUT yet
    // existing in config.more — e.g. discovered from disk. Clicking its
    // "+" calls promote(rel) directly. Before the fix, promote's
    // `{ rel }` fallback produced a MAIN tile with no `userPinned`, so the
    // next real `loadWorkstationConfig` migration (`mainHasNonPrimitive`)
    // treated it as a legacy auto-derived tile and wiped it from MAIN.
    mockedTally.mockReturnValue({ todos: 0, inProgress: 0, completeToday: 0 });

    const REL = "filestores/library";
    // Config the component loads on mount: three MAIN primitives, and the
    // sub-store is NOT in config.more (it's only auto-discovered).
    const initialConfig = {
      main: [
        { rel: "tasks" },
        { rel: "knowledge" },
        { rel: "filestores/commands" },
      ],
      more: [],
    };
    mockedLoadCfg.mockResolvedValue(structuredClone(initialConfig) as never);
    // But the resolved MORE grid surfaces the discovered sub-store so its
    // "+" button renders.
    mockedMerge.mockReturnValue({
      main: [
        { rel: "knowledge", label: "Knowledge", tone: "ochre", icon: "kb" } as never,
        { rel: "filestores/commands", label: "Commands", tone: "accent", icon: "commands" } as never,
      ],
      more: [
        { rel: REL, label: "Library", tone: "neutral", icon: "folder", countMode: "files" } as never,
      ],
    });

    let savedConfig: unknown = null;
    mockedSaveCfg.mockImplementation(async (_repo, cfg) => {
      savedConfig = cfg;
    });

    await renderAndWait({
      repo: "/r",
      fsTick: 0,
      onOpen: vi.fn(),
      onShowFiles: vi.fn(),
    });

    // Open the "More" section so the picker grid (and the "+" button)
    // mounts.
    fireEvent.click(screen.getByText("More"));
    const addHint = screen.getByTitle("Pin Library to workstation");
    await act(async () => {
      fireEvent.click(addHint);
    });

    // promote() persisted a new config. Capture what it wrote.
    expect(savedConfig).not.toBeNull();
    const persisted = savedConfig as { main: { rel: string; userPinned?: boolean }[] };
    const promotedTile = persisted.main.find((t) => t.rel === REL);
    expect(promotedTile).toBeTruthy();
    // The crux: promote must stamp userPinned so the tile survives the
    // migration on the next load.
    expect(promotedTile?.userPinned).toBe(true);

    // Now simulate the next reload through the REAL load/migration logic.
    vi.mocked(mockedFsReadFn).mockResolvedValueOnce(JSON.stringify(persisted));
    const reloaded = await realLoadWorkstationConfig("/r");

    // The promoted sub-store must still be in MAIN — not wiped.
    expect(reloaded.main.map((t) => t.rel)).toContain(REL);
  });
});
