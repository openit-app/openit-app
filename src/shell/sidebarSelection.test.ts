import { describe, expect, it } from "vitest";
import { selectedRelFromSource } from "./sidebarSelection";

const REPO = "/vault";

describe("selectedRelFromSource", () => {
  it("returns null for empty source or missing repo", () => {
    expect(selectedRelFromSource(null, REPO)).toBeNull();
    expect(
      selectedRelFromSource({ kind: "tools" }, null),
    ).toBeNull();
  });

  it("maps top-level list views to their primitive tile rel", () => {
    expect(selectedRelFromSource({ kind: "databases-list" }, REPO)).toBe(
      "databases",
    );
    expect(selectedRelFromSource({ kind: "filestores-list" }, REPO)).toBe(
      "filestores",
    );
    expect(selectedRelFromSource({ kind: "knowledge-list" }, REPO)).toBe(
      "knowledge-bases",
    );
    expect(selectedRelFromSource({ kind: "tools" }, REPO)).toBe("tools");
  });

  it("maps inbox-style views to databases/tickets", () => {
    expect(
      selectedRelFromSource({ kind: "conversations-list" }, REPO),
    ).toBe("databases/tickets");
    expect(
      selectedRelFromSource(
        { kind: "conversation-thread", ticketId: "t-123" },
        REPO,
      ),
    ).toBe("databases/tickets");
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
        { kind: "entity-folder", entity: "knowledge", path: "knowledge-bases/runbooks" } as never,
        REPO,
      ),
    ).toBe("knowledge-bases/runbooks");
  });

  it("falls back to the owning top-folder for raw file paths", () => {
    expect(
      selectedRelFromSource(
        { kind: "file", path: `${REPO}/knowledge-bases/runbooks/onboarding.md` },
        REPO,
      ),
    ).toBe("knowledge-bases");
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

  it("returns null for files outside the repo", () => {
    expect(
      selectedRelFromSource(
        { kind: "file", path: "/somewhere/else/file.md" },
        REPO,
      ),
    ).toBeNull();
  });

  it("returns null for trace views (no station tile pulses)", () => {
    expect(selectedRelFromSource({ kind: "traces-list" }, REPO)).toBe(
      ".openit/agent-traces",
    );
  });

  it("returns null for unknown source kinds (sync, diff, workflow)", () => {
    expect(
      selectedRelFromSource({ kind: "sync", lines: [] } as never, REPO),
    ).toBeNull();
    expect(
      selectedRelFromSource({ kind: "diff" } as never, REPO),
    ).toBeNull();
  });
});
