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
  updateTaskAssignee,
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
    const raw = `---\nstatus: in-progress\ntitle: "VPN rollout"\nassignee: "Sankalp"\ncreatedAt: 2026-05-23T00:00:00Z\n---\n\nbody line\n`;
    const parsed = parseTaskMarkdown(raw, "fallback");
    expect(parsed).toEqual({
      status: "in-progress",
      title: "VPN rollout",
      assignee: "Sankalp",
      createdAt: "2026-05-23T00:00:00Z",
      body: "body line\n",
    });
  });

  it("defaults assignee to empty string for legacy tasks missing the field", () => {
    const raw = `---\nstatus: todo\ntitle: "Pre-assignee task"\ncreatedAt: 2026-05-23T00:00:00Z\n---\n`;
    const parsed = parseTaskMarkdown(raw, "fallback");
    expect(parsed.assignee).toBe("");
    expect(parsed.title).toBe("Pre-assignee task");
  });

  it("tolerates missing frontmatter — treats the whole file as the body", () => {
    const parsed = parseTaskMarkdown("just some text", "fallback-title");
    expect(parsed.status).toBe("todo");
    expect(parsed.title).toBe("fallback-title");
    expect(parsed.assignee).toBe("");
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
    const raw = `---\nbogusKey: whatever\nstatus: todo\ntitle: "ok"\n---\nbody`;
    expect(parseTaskMarkdown(raw, "fb").title).toBe("ok");
  });
});

describe("serialiseTaskMarkdown round-trips", () => {
  it("preserves status / title / assignee / body across a parse-serialise cycle", () => {
    const original = {
      status: "complete" as const,
      title: "Test \"with\" quotes",
      assignee: "Alex \"Lex\"",
      createdAt: "2026-05-23T01:02:03Z",
      body: "Some\nmulti-line body.\n",
    };
    const raw = serialiseTaskMarkdown(original);
    const reparsed = parseTaskMarkdown(raw, "fb");
    expect(reparsed.status).toBe(original.status);
    expect(reparsed.title).toBe(original.title);
    expect(reparsed.assignee).toBe(original.assignee);
    expect(reparsed.createdAt).toBe(original.createdAt);
    expect(reparsed.body).toBe(original.body);
  });

  it("emits an empty assignee field for unassigned tasks", () => {
    const raw = serialiseTaskMarkdown({
      status: "todo",
      title: "no one yet",
      assignee: "",
      createdAt: "2026-05-23T00:00:00Z",
      body: "",
    });
    expect(raw).toContain('assignee: ""');
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
    expect(filename).toMatch(/^task-\d+-[0-9a-f]{8}\.md$/);
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

  it("rejects an empty or whitespace-only title", async () => {
    await expect(createTask("/r", { title: "" })).rejects.toThrow(/empty/);
    await expect(createTask("/r", { title: "   " })).rejects.toThrow(/empty/);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it("trims surrounding whitespace from the title", async () => {
    mockedWrite.mockResolvedValueOnce(undefined);
    const s = await createTask("/r", { title: "   Ship   " });
    expect(s.title).toBe("Ship");
  });

  it("writes the assignee through to disk and the returned summary", async () => {
    mockedWrite.mockResolvedValueOnce(undefined);
    const s = await createTask("/r", { title: "Ship it", assignee: "Sankalp" });
    expect(s.assignee).toBe("Sankalp");
    const [, , , content] = mockedWrite.mock.calls[0];
    expect(content).toContain('assignee: "Sankalp"');
  });

  it("defaults assignee to empty string when omitted", async () => {
    mockedWrite.mockResolvedValueOnce(undefined);
    const s = await createTask("/r", { title: "Ship it" });
    expect(s.assignee).toBe("");
    const [, , , content] = mockedWrite.mock.calls[0];
    expect(content).toContain('assignee: ""');
  });

  it("trims whitespace from the assignee", async () => {
    mockedWrite.mockResolvedValueOnce(undefined);
    const s = await createTask("/r", { title: "x", assignee: "   Ben   " });
    expect(s.assignee).toBe("Ben");
  });
});

describe("updateTaskAssignee", () => {
  it("preserves status / title / body when changing assignee", async () => {
    mockedFsRead.mockResolvedValueOnce(
      `---\nstatus: in-progress\ntitle: "Keep me"\nassignee: "Old"\ncreatedAt: 2026-05-23T00:00:00Z\n---\n\nimportant body\n`,
    );
    mockedWrite.mockResolvedValueOnce(undefined);
    const result = await updateTaskAssignee("/r", "task-1.md", "New");
    expect(result.assignee).toBe("New");
    expect(result.status).toBe("in-progress");
    const [, , , content] = mockedWrite.mock.calls[0];
    expect(content).toContain('assignee: "New"');
    expect(content).toContain("status: in-progress");
    expect(content).toContain('title: "Keep me"');
    expect(content).toContain("important body");
  });

  it("trims surrounding whitespace from the new assignee", async () => {
    mockedFsRead.mockResolvedValueOnce(
      `---\nstatus: todo\ntitle: "x"\nassignee: ""\ncreatedAt: 2026-05-23T00:00:00Z\n---\n`,
    );
    mockedWrite.mockResolvedValueOnce(undefined);
    const result = await updateTaskAssignee("/r", "task-1.md", "   Ada   ");
    expect(result.assignee).toBe("Ada");
  });

  it("throws when the file does not exist", async () => {
    mockedFsRead.mockRejectedValueOnce(new Error("ENOENT"));
    await expect(updateTaskAssignee("/r", "missing.md", "Ada")).rejects.toThrow(
      /no longer exists/,
    );
    expect(mockedWrite).not.toHaveBeenCalled();
  });
});

describe("updateTaskStatus", () => {
  it("preserves the existing title and body when flipping status", async () => {
    mockedFsRead.mockResolvedValueOnce(
      `---\nstatus: todo\ntitle: "Keep me"\ncreatedAt: 2026-05-23T00:00:00Z\n---\n\nimportant body\n`,
    );
    mockedWrite.mockResolvedValueOnce(undefined);
    const result = await updateTaskStatus("/r", "task-1.md", "in-progress");
    const [, , , content] = mockedWrite.mock.calls[0];
    expect(content).toContain("status: in-progress");
    expect(content).toContain('title: "Keep me"');
    expect(content).toContain("important body");
    expect(result.status).toBe("in-progress");
  });

  it("re-reads current status from disk when given a resolver function", async () => {
    // The on-disk status has already advanced to "in-progress" since
    // the caller's snapshot was rendered. Re-resolving from the real
    // disk state must yield "complete", not "in-progress" (which is
    // what a stale closure over the prop snapshot would produce).
    mockedFsRead.mockResolvedValueOnce(
      `---\nstatus: in-progress\ntitle: "x"\ncreatedAt: 2026-05-23T00:00:00Z\n---\n`,
    );
    mockedWrite.mockResolvedValueOnce(undefined);
    const result = await updateTaskStatus("/r", "task-1.md", nextStatus);
    expect(result.status).toBe("complete");
    const [, , , content] = mockedWrite.mock.calls[0];
    expect(content).toContain("status: complete");
  });

  it("throws when the file does not exist so the caller can surface a toast", async () => {
    mockedFsRead.mockRejectedValueOnce(new Error("ENOENT"));
    await expect(updateTaskStatus("/r", "missing.md", "complete")).rejects.toThrow(
      /no longer exists/,
    );
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
      { path: "", filename: "", title: "", status: "todo", assignee: "", createdAt: "", body: "" },
      { path: "", filename: "", title: "", status: "todo", assignee: "", createdAt: "", body: "" },
      { path: "", filename: "", title: "", status: "in-progress", assignee: "", createdAt: "", body: "" },
      { path: "", filename: "", title: "", status: "complete", assignee: "", createdAt: "", body: "" },
    ];
    expect(tallyTasks(tasks)).toEqual({ todo: 2, inProgress: 1, complete: 1, total: 4 });
  });
});

describe("newTaskFilename", () => {
  it("produces a sortable filename containing the timestamp and 8 hex chars", () => {
    const a = newTaskFilename(1716480000000);
    expect(a).toMatch(/^task-1716480000000-[0-9a-f]{8}\.md$/);
  });
});

describe("listTasks — createdAt sort", () => {
  it("places tasks without createdAt at the bottom (not the top)", async () => {
    mockedFsList.mockResolvedValueOnce([
      file("hand-edited.md", "/r/tasks/hand-edited.md"),
      file("task-recent.md", "/r/tasks/task-recent.md"),
    ]);
    mockedFsRead
      // No createdAt — empty string falls back from the parser.
      .mockResolvedValueOnce(`---\nstatus: todo\ntitle: "Ancient"\n---\n`)
      .mockResolvedValueOnce(
        `---\nstatus: todo\ntitle: "Recent"\ncreatedAt: 2026-05-23T00:00:00Z\n---\n`,
      );
    const out = await listTasks("/r");
    expect(out.map((t) => t.title)).toEqual(["Recent", "Ancient"]);
  });
});
