import { describe, expect, it } from "vitest";
import { selectedRelFromSource } from "./sidebarSelection";

const REPO = "/vault";

describe("selectedRelFromSource", () => {
  it("returns null for empty source or missing repo", () => {
    expect(selectedRelFromSource(null, REPO)).toBeNull();
    expect(selectedRelFromSource({ kind: "tools" }, null)).toBeNull();
  });

  it("maps top-level list views to their primitive tile rel", () => {
    expect(selectedRelFromSource({ kind: "databases-list" }, REPO)).toBe(
      "databases",
    );
    expect(selectedRelFromSource({ kind: "filestores-list" }, REPO)).toBe(
      "filestores",
    );
    // Knowledge tile rel is "knowledge" (NOT "knowledge-bases" — the
    // on-disk folder is `knowledge/`, see workstationConfig
    // discoverTiles).
    expect(selectedRelFromSource({ kind: "knowledge-list" }, REPO)).toBe(
      "knowledge",
    );
    expect(selectedRelFromSource({ kind: "tools" }, REPO)).toBe("tools");
  });

  it("returns null for inbox-style views (no pinned tile — hero card handles them)", () => {
    expect(
      selectedRelFromSource({ kind: "conversations-list" }, REPO),
    ).toBeNull();
    expect(
      selectedRelFromSource(
        { kind: "conversation-thread", ticketId: "t-123" },
        REPO,
      ),
    ).toBeNull();
  });

  it("maps datastore-table to databases/<collection>", () => {
    expect(
      selectedRelFromSource(
        {
          kind: "datastore-table",
          collection: { name: "people" },
        } as never,
        REPO,
      ),
    ).toBe("databases/people");
  });

  it("maps station kinds to their filestore tiles", () => {
    expect(selectedRelFromSource({ kind: "skills-station" }, REPO)).toBe(
      "filestores/skills",
    );
    expect(selectedRelFromSource({ kind: "scripts-station" }, REPO)).toBe(
      "filestores/scripts",
    );
    expect(selectedRelFromSource({ kind: "commands-station" }, REPO)).toBe(
      "filestores/commands",
    );
  });

  it("returns the entity-folder path verbatim", () => {
    expect(
      selectedRelFromSource(
        {
          kind: "entity-folder",
          entity: "knowledge",
          path: "knowledge/runbooks",
        } as never,
        REPO,
      ),
    ).toBe("knowledge/runbooks");
  });

  it("returns the user-pinned store path for entity-folder under a primitive", () => {
    expect(
      selectedRelFromSource(
        {
          kind: "entity-folder",
          entity: "databases",
          path: "databases/vendors",
        } as never,
        REPO,
      ),
    ).toBe("databases/vendors");
  });

  it("falls back to the owning top-folder for raw file paths", () => {
    expect(
      selectedRelFromSource(
        {
          kind: "file",
          path: `${REPO}/knowledge/runbooks/onboarding.md`,
        },
        REPO,
      ),
    ).toBe("knowledge");
  });

  it("uses two-segment owner for files under databases/ or filestores/", () => {
    expect(
      selectedRelFromSource(
        { kind: "file", path: `${REPO}/databases/people/alice.json` },
        REPO,
      ),
    ).toBe("databases/people");
    expect(
      selectedRelFromSource(
        { kind: "file", path: `${REPO}/filestores/scripts/cleanup.sh` },
        REPO,
      ),
    ).toBe("filestores/scripts");
  });

  it("normalizes Windows backslash separators in file paths", () => {
    // Tauri commands on Windows can return mixed-separator paths.
    // Without normalization, the prefix check fails and the rail
    // never highlights the owning tile for file-explorer opens.
    expect(
      selectedRelFromSource(
        {
          kind: "file",
          path: `${REPO}\\databases\\people\\alice.json`,
        },
        REPO,
      ),
    ).toBe("databases/people");
    expect(
      selectedRelFromSource(
        {
          kind: "file",
          path: "C:\\vault\\knowledge\\runbooks\\x.md",
        },
        "C:\\vault",
      ),
    ).toBe("knowledge");
  });

  it("returns null for files outside the repo", () => {
    expect(
      selectedRelFromSource(
        { kind: "file", path: "/somewhere/else/file.md" },
        REPO,
      ),
    ).toBeNull();
  });

  it("maps trace views to the traces tile rel (not the on-disk folder path)", () => {
    // The Traces tile's rel is "traces" — the on-disk folder is
    // `.openit/agent-traces/` but the workstation tile's identity is
    // the short form.
    expect(selectedRelFromSource({ kind: "traces-list" }, REPO)).toBe(
      "traces",
    );
    expect(
      selectedRelFromSource(
        { kind: "agent-trace", ticketId: "t-1" } as never,
        REPO,
      ),
    ).toBe("traces");
  });

  it("maps tasks-list viewer to the tasks primitive tile", () => {
    // The Tasks primitive (PIN-6605) gets its own pinned tile in the
    // workstation; the collapsed rail should highlight it whenever the
    // tasks list is open. Agent / workflow source kinds were retired
    // in PIN-6606 — Claude Code is the only agent now.
    expect(
      selectedRelFromSource(
        { kind: "tasks-list", tasks: [] } as never,
        REPO,
      ),
    ).toBe("tasks");
  });

  it("returns null for unknown source kinds (sync, diff)", () => {
    expect(
      selectedRelFromSource({ kind: "sync", lines: [] } as never, REPO),
    ).toBeNull();
    expect(selectedRelFromSource({ kind: "diff" } as never, REPO)).toBeNull();
  });
});
