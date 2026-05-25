// Tests for the task-stages config — the persisted column list that
// drives the Kanban viewer. Covers seeding on first launch, parse
// tolerance for hand-edited files, stage matching (case + whitespace),
// and the next-stage rotation that powers keyboard cycling.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fsRead: vi.fn(),
  entityWriteFile: vi.fn(),
}));

import { fsRead, entityWriteFile } from "./api";
import {
  DEFAULT_STAGES,
  UNSORTED_STAGE,
  loadStages,
  nextStage,
  saveStages,
  stageForStatus,
} from "./taskStages";

const mockedFsRead = vi.mocked(fsRead);
const mockedWrite = vi.mocked(entityWriteFile);

beforeEach(() => {
  mockedFsRead.mockReset();
  mockedWrite.mockReset();
});

describe("loadStages", () => {
  it("returns the parsed stage list when the file is well-formed", async () => {
    mockedFsRead.mockResolvedValueOnce(
      JSON.stringify({ stages: ["Backlog", "Doing", "Done"] }),
    );
    expect(await loadStages("/r")).toEqual(["Backlog", "Doing", "Done"]);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it("seeds the defaults to disk and returns them on first launch", async () => {
    mockedFsRead.mockRejectedValueOnce(new Error("ENOENT"));
    mockedWrite.mockResolvedValueOnce(undefined);
    const result = await loadStages("/r");
    expect(result).toEqual([...DEFAULT_STAGES]);
    // Best-effort write happens in the background; flush microtasks
    // before asserting.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockedWrite).toHaveBeenCalledTimes(1);
    const [, subdir, filename] = mockedWrite.mock.calls[0];
    expect(subdir).toBe(".openit");
    expect(filename).toBe("tasks-stages.json");
  });

  it("falls back to defaults when the file is unparseable JSON", async () => {
    mockedFsRead.mockResolvedValueOnce("not json {");
    expect(await loadStages("/r")).toEqual([...DEFAULT_STAGES]);
    // Don't re-seed on parse failure — that would clobber the user's
    // hand-edited file.
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it("falls back to defaults when the JSON has no stages array", async () => {
    mockedFsRead.mockResolvedValueOnce(JSON.stringify({ stages: "nope" }));
    expect(await loadStages("/r")).toEqual([...DEFAULT_STAGES]);
  });

  it("trims whitespace and drops empty entries", async () => {
    mockedFsRead.mockResolvedValueOnce(
      JSON.stringify({ stages: ["  Todo  ", "", "Done"] }),
    );
    expect(await loadStages("/r")).toEqual(["Todo", "Done"]);
  });

  it("de-duplicates repeated stage names", async () => {
    mockedFsRead.mockResolvedValueOnce(
      JSON.stringify({ stages: ["Todo", "Todo", "Done"] }),
    );
    expect(await loadStages("/r")).toEqual(["Todo", "Done"]);
  });

  it("falls back to defaults when the array cleans down to empty", async () => {
    mockedFsRead.mockResolvedValueOnce(JSON.stringify({ stages: ["", "   "] }));
    expect(await loadStages("/r")).toEqual([...DEFAULT_STAGES]);
  });
});

describe("saveStages", () => {
  it("writes the cleaned stage list as pretty JSON", async () => {
    mockedWrite.mockResolvedValueOnce(undefined);
    await saveStages("/r", ["Todo", "Doing", "Done"]);
    const [repo, subdir, filename, content] = mockedWrite.mock.calls[0];
    expect(repo).toBe("/r");
    expect(subdir).toBe(".openit");
    expect(filename).toBe("tasks-stages.json");
    expect(JSON.parse(content as string)).toEqual({
      stages: ["Todo", "Doing", "Done"],
    });
  });

  it("substitutes defaults when the cleaned list is empty", async () => {
    mockedWrite.mockResolvedValueOnce(undefined);
    await saveStages("/r", ["", "  "]);
    const [, , , content] = mockedWrite.mock.calls[0];
    expect(JSON.parse(content as string).stages).toEqual([...DEFAULT_STAGES]);
  });
});

describe("stageForStatus", () => {
  const stages = ["Todo", "In Progress", "Complete"];

  it("returns the matching stage when the status hits exactly", () => {
    expect(stageForStatus("Todo", stages)).toBe("Todo");
    expect(stageForStatus("In Progress", stages)).toBe("In Progress");
  });

  it("matches case-insensitively and tolerates extra whitespace", () => {
    expect(stageForStatus("  todo  ", stages)).toBe("Todo");
    expect(stageForStatus("IN PROGRESS", stages)).toBe("In Progress");
  });

  it("returns the Unsorted sentinel for an unmatched status", () => {
    expect(stageForStatus("Blocked", stages)).toBe(UNSORTED_STAGE);
  });

  it("returns the Unsorted sentinel for an empty status", () => {
    expect(stageForStatus("", stages)).toBe(UNSORTED_STAGE);
    expect(stageForStatus("   ", stages)).toBe(UNSORTED_STAGE);
  });
});

describe("nextStage", () => {
  const stages = ["Todo", "In Progress", "Complete"];

  it("advances to the next stage in the list", () => {
    expect(nextStage("Todo", stages)).toBe("In Progress");
    expect(nextStage("In Progress", stages)).toBe("Complete");
  });

  it("wraps from the last stage to the first", () => {
    expect(nextStage("Complete", stages)).toBe("Todo");
  });

  it("matches case-insensitively", () => {
    expect(nextStage("todo", stages)).toBe("In Progress");
  });

  it("returns the first stage when the current stage is unknown", () => {
    expect(nextStage("Unknown", stages)).toBe("Todo");
  });

  it("returns the current stage when the configured list is empty", () => {
    expect(nextStage("Anything", [])).toBe("Anything");
  });
});
