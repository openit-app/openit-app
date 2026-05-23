import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Hoisted mocks for the lib/api surface SkillsStation pulls in. The
// component uses fsList/fsRead to enumerate existing commands and
// entityWriteFile to materialise a new one — fake those so we can run
// the + New flow with no Tauri runtime present.
const apiMock = vi.hoisted(() => ({
  fsList: vi.fn().mockResolvedValue([]),
  fsRead: vi.fn().mockResolvedValue(""),
  entityWriteFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/api", () => apiMock);

// activeSession.writeToActiveSession is the Claude handoff. We swap
// the whole module so writes are observable without a live PTY.
const activeSessionMock = vi.hoisted(() => ({
  writeToActiveSession: vi.fn().mockResolvedValue(true),
}));
vi.mock("./activeSession", () => activeSessionMock);

import { CommandsStation } from "./SkillsStation";

describe("CommandsStation + New flow", () => {
  beforeEach(() => {
    apiMock.fsList.mockReset().mockResolvedValue([]);
    apiMock.fsRead.mockReset().mockResolvedValue("");
    apiMock.entityWriteFile.mockReset().mockResolvedValue(undefined);
    activeSessionMock.writeToActiveSession.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  it("dismissing the intent prompt creates nothing and does not call Claude", async () => {
    render(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    // Composer opens with the dialog role we attached.
    const dialog = await screen.findByRole("dialog", { name: /create new command/i });
    expect(dialog).toBeInTheDocument();

    // Cancel — neither the filesystem nor the PTY should be touched.
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(apiMock.entityWriteFile).not.toHaveBeenCalled();
    expect(activeSessionMock.writeToActiveSession).not.toHaveBeenCalled();
  });

  it("submitting writes the file, opens it, and hands intent to Claude", async () => {
    const onOpen = vi.fn();
    render(<CommandsStation repo="/tmp/repo" onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "aws-cost-dash" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Summarise the last 7 days of AWS spend by service." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(apiMock.entityWriteFile).toHaveBeenCalledTimes(1));

    const [repoArg, subdir, filename, body] = apiMock.entityWriteFile.mock.calls[0];
    expect(repoArg).toBe("/tmp/repo");
    expect(subdir).toBe("filestores/commands");
    expect(filename).toBe("aws-cost-dash.md");
    // Frontmatter and body should both carry the user's wording.
    expect(body).toContain("Summarise the last 7 days of AWS spend by service.");
    expect(body).toMatch(/description: "Summarise the last 7 days/);

    // Viewer should jump straight to the new file.
    expect(onOpen).toHaveBeenCalledWith("/tmp/repo/filestores/commands/aws-cost-dash.md");

    // Claude gets the intent + the file path in its first turn.
    await waitFor(() =>
      expect(activeSessionMock.writeToActiveSession).toHaveBeenCalledTimes(1),
    );
    const prompt = activeSessionMock.writeToActiveSession.mock.calls[0][0];
    expect(prompt).toContain("filestores/commands/aws-cost-dash.md");
    expect(prompt).toContain("Summarise the last 7 days of AWS spend by service.");
    // Carriage return is required to fire the slash command properly.
    expect(prompt.endsWith("\r")).toBe(true);
  });

  it("submit is disabled until both name and intent are provided", async () => {
    render(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    const create = screen.getByRole("button", { name: /^create$/i });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "my-cmd" },
    });
    expect(create).toBeDisabled();

    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Do the thing." } },
    );
    expect(create).not.toBeDisabled();
  });
});
