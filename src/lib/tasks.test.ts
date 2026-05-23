// Tests for the tasks library — covers frontmatter parse/serialise, the
// listing scanner, status cycling, and the per-task helpers. Tasks back
// the Inbox station; wrong frontmatter handling silently loses user
// state, so these tests guard the file format directly.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fsList: vi.fn(),
  fsRead: vi.fn(),
  fsDelete: vi.fn(),
  entityWriteFile: vi.fn(),
}));

import { fsList, fsRead, fsDelete, entityWriteFile, type FileNode } from "./api";
import {
  createTask,
  deleteTask,
  listTasks,
  nextStatus,
  newTaskFilename,
  parseTaskMarkdown,
  readTask,
  serialiseTaskMarkdown,
  tallyTasks,
  updateTaskStatus,
  type TaskSummary,
} from "./tasks";

const mockedFsList = vi.mocked(fsList);
const mockedFsRead = vi.mocked(fsRead);
const mockedFsDelete = vi.mocked(fsDelete);
const mockedWrite = vi.mocked(entityWriteFile);

beforeEach(() => {
  mockedFsList.mockReset();
  mockedFsRead.mockReset();
  mockedFsDelete.mockReset();
  mockedWrite.mockReset();
});

function file(name: string, path: string): FileNode {
  return { name, path, is_dir: false };
}

describe("parseTaskMarkdown", () => {
  it("parses the canonical shape we emit", () => {
    const raw = `---\nstatus: in-progress\ntitle: "VPN rollout"\ncreatedAt: 2026-05-23T00:00:00Z\n---\n\nbody line\n`;
    const parsed = parseTaskMarkdown(raw, "fallback");
    expect(parsed).toEqual({
      status: "in-progress",
      title: "VPN rollout",
      createdAt: "2026-05-23T00:00:00Z",
      body: "body line\n",
    });
  });

  it("tolerates missing frontmatter — treats the whole file as the body", () => {
    const parsed = parseTaskMarkdown("just some text", "fallback-title");
    expect(parsed.status).toBe("todo");
    expect(parsed.title).toBe("fallback-title");
    expect(parsed.createdAt).toBe("");
    expect(parsed.body).toBe("just some text");
  });

  it("rejects an unknown status value rather than letting it through", () => {
    const raw = `---\nstatus: bogus\ntitle: "x"\n---\n`;
    const parsed = parseTaskMarkdown(raw, "fallback");
    expect(parsed.status).toBe("todo");
  });

  it("strips both single and double quotes from values", () => {
    const raw = `---\ntitle: 'quoted title'\nstatus: complete\n---\nbody`;
    expect(parseTaskMarkdown(raw, "fb").title).toBe("quoted title");
  });

  it("ignores unknown keys without crashing", () => {
    const raw = `---\nassignee: me\nstatus: todo\ntitle: "ok"\n---\nbody`;
    expect(parseTaskMarkdown(raw, "fb").title).toBe("ok");
  });
});

describe("serialiseTaskMarkdown round-trips", () => {
  it("preserves status / title / body across a parse-serialise cycle", () => {
    const original = {
      status: "complete" as const,
      title: "Test \"with\" quotes",
      createdAt: "2026-05-23T01:02:03Z",
      body: "Some\nmulti-line body.\n",
    };
    const raw = serialiseTaskMarkdown(original);
    const reparsed = parseTaskMarkdown(raw, "fb");
    expect(reparsed.status).toBe(original.status);
    expect(reparsed.title).toBe(original.title);
    expect(reparsed.createdAt).toBe(original.createdAt);
    expect(reparsed.body).toBe(original.body);
  });
});

describe("listTasks", () => {
  it("returns parsed summaries from the tasks directory, newest first", async () => {
    const repo = "/r";
    mockedFsList.mockResolvedValueOnce([
      file("task-1.md", "/r/tasks/task-1.md"),
      file("task-2.md", "/r/tasks/task-2.md"),
    ]);
    mockedFsRead
      .mockResolvedValueOnce(
        `---\nstatus: todo\ntitle: "older"\ncreatedAt: 2026-05-22T00:00:00Z\n---\n`,
      )
      .mockResolvedValueOnce(
        `---\nstatus: complete\ntitle: "newer"\ncreatedAt: 2026-05-23T00:00:00Z\n---\n`,
      );
    const out = await listTasks(repo);
    expect(out.map((t) => t.title)).toEqual(["newer", "older"]);
  });

  it("returns [] when tasks/ does not exist yet", async () => {
    mockedFsList.mockRejectedValueOnce(new Error("ENOENT"));
    expect(await listTasks("/r")).toEqual([]);
  });

  it("skips non-markdown files and subdirectories", async () => {
    const repo = "/r";
    mockedFsList.mockResolvedValueOnce([
      { name: "subdir", path: "/r/tasks/subdir", is_dir: true } as FileNode,
      file("notes.txt", "/r/tasks/notes.txt"),
      file("task-1.md", "/r/tasks/task-1.md"),
    ]);
    mockedFsRead.mockResolvedValueOnce(
      `---\nstatus: todo\ntitle: "only-md"\ncreatedAt: 2026-05-23T00:00:00Z\n---\n`,
    );
    const out = await listTasks(repo);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("only-md");
  });

  it("skips unreadable files without aborting the scan", async () => {
    const repo = "/r";
    mockedFsList.mockResolvedValueOnce([
      file("bad.md", "/r/tasks/bad.md"),
      file("good.md", "/r/tasks/good.md"),
    ]);
    mockedFsRead
      .mockRejectedValueOnce(new Error("EACCES"))
      .mockResolvedValueOnce(
        `---\nstatus: todo\ntitle: "good"\ncreatedAt: 2026-05-23T00:00:00Z\n---\n`,
      );
    const out = await listTasks(repo);
    expect(out.map((t) => t.title)).toEqual(["good"]);
  });

  it("falls back to filename stem when frontmatter title is missing", async () => {
    const repo = "/r";
    mockedFsList.mockResolvedValueOnce([
      file("task-no-frontmatter.md", "/r/tasks/task-no-frontmatter.md"),
    ]);
    mockedFsRead.mockResolvedValueOnce("body only, no frontmatter");
    const out = await listTasks(repo);
    expect(out[0].title).toBe("task-no-frontmatter");
  });
});

describe("readTask", () => {
  it("returns null for a missing file", async () => {
    mockedFsRead.mockRejectedValueOnce(new Error("ENOENT"));
    expect(await readTask("/r", "missing.md")).toBeNull();
  });
});

describe("createTask", () => {
  it("writes a task file with frontmatter and returns the summary", async () => {
    mockedWrite.mockResolvedValueOnce(undefined);
    const summary = await createTask("/r", { title: "Ship it" });
    expect(mockedWrite).toHaveBeenCalledTimes(1);
    const [, subdir, filename, content] = mockedWrite.mock.calls[0];
    expect(subdir).toBe("tasks");
    expect(filename).toMatch(/^task-\d+-[0-9a-f]{4}\.md$/);
    expect(content).toContain('status: todo');
    expect(content).toContain('title: "Ship it"');
    expect(summary.title).toBe("Ship it");
    expect(summary.status).toBe("todo");
  });

  it("respects an explicit status and body", async () => {
    mockedWrite.mockResolvedValueOnce(undefined);
    await createTask("/r", { title: "A", status: "complete", body: "done." });
    const [, , , content] = mockedWrite.mock.calls[0];
    expect(content).toContain("status: complete");
    expect(content).toContain("done.");
  });
});

describe("updateTaskStatus", () => {
  it("preserves the existing title and body when flipping status", async () => {
    mockedFsRead.mockResolvedValueOnce(
      `---\nstatus: todo\ntitle: "Keep me"\ncreatedAt: 2026-05-23T00:00:00Z\n---\n\nimportant body\n`,
    );
    mockedWrite.mockResolvedValueOnce(undefined);
    await updateTaskStatus("/r", "task-1.md", "in-progress");
    const [, , , content] = mockedWrite.mock.calls[0];
    expect(content).toContain("status: in-progress");
    expect(content).toContain('title: "Keep me"');
    expect(content).toContain("important body");
  });

  it("no-ops when the file does not exist", async () => {
    mockedFsRead.mockRejectedValueOnce(new Error("ENOENT"));
    await updateTaskStatus("/r", "missing.md", "complete");
    expect(mockedWrite).not.toHaveBeenCalled();
  });
});

describe("deleteTask", () => {
  it("delegates to fsDelete with the full path", async () => {
    mockedFsDelete.mockResolvedValueOnce(undefined);
    await deleteTask("/r", "task-1.md");
    expect(mockedFsDelete).toHaveBeenCalledWith("/r/tasks/task-1.md");
  });
});

describe("nextStatus", () => {
  it("cycles todo -> in-progress -> complete -> todo", () => {
    expect(nextStatus("todo")).toBe("in-progress");
    expect(nextStatus("in-progress")).toBe("complete");
    expect(nextStatus("complete")).toBe("todo");
  });
});

describe("tallyTasks", () => {
  it("counts tasks per status and total", () => {
    const tasks: TaskSummary[] = [
      { path: "", filename: "", title: "", status: "todo", createdAt: "", body: "" },
      { path: "", filename: "", title: "", status: "todo", createdAt: "", body: "" },
      { path: "", filename: "", title: "", status: "in-progress", createdAt: "", body: "" },
      { path: "", filename: "", title: "", status: "complete", createdAt: "", body: "" },
    ];
    expect(tallyTasks(tasks)).toEqual({ todo: 2, inProgress: 1, complete: 1, total: 4 });
  });
});

describe("newTaskFilename", () => {
  it("produces a sortable filename containing the timestamp", () => {
    const a = newTaskFilename(1716480000000);
    expect(a).toMatch(/^task-1716480000000-[0-9a-f]{4}\.md$/);
  });
});
