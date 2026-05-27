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

import { listTasks, tallyTasksToday } from "../lib/tasks";
import { Workbench } from "./Workbench";

const mockedListTasks = vi.mocked(listTasks);
const mockedTally = vi.mocked(tallyTasksToday);

beforeEach(() => {
  mockedListTasks.mockReset();
  mockedTally.mockReset();
  mockedListTasks.mockResolvedValue([]);
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
});
