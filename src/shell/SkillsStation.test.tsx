import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ToastProvider } from "../Toast";

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
// Default returns `true` (an active session existed and the write
// landed). Individual tests override to `false` to simulate the
// no-session path.
const activeSessionMock = vi.hoisted(() => ({
  writeToActiveSession: vi.fn().mockResolvedValue(true),
}));
vi.mock("./activeSession", () => activeSessionMock);

import { CommandsStation } from "./SkillsStation";

// Wrap renders in the real ToastProvider so useToast() resolves and
// the no-session warn toast can be asserted in the DOM.
function renderInToastProvider(node: ReactNode) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

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
    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);

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
    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={onOpen} />);

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
    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
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

  it("pressing Enter on the name field submits once both fields are filled", async () => {
    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    const nameInput = screen.getByPlaceholderText("command-name");
    fireEvent.change(nameInput, { target: { value: "my-cmd" } });

    // Enter with no intent → must NOT submit.
    fireEvent.keyDown(nameInput, { key: "Enter" });
    await new Promise((r) => setTimeout(r, 0));
    expect(apiMock.entityWriteFile).not.toHaveBeenCalled();

    // Fill intent, hit Enter on the name → submits.
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Do the thing." } },
    );
    fireEvent.keyDown(nameInput, { key: "Enter" });
    await waitFor(() => expect(apiMock.entityWriteFile).toHaveBeenCalledTimes(1));
  });

  it("escapes triple-backticks in the intent body so the markdown viewer doesn't fence", async () => {
    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "fenced" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Run ```bash echo hi``` then exit." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(apiMock.entityWriteFile).toHaveBeenCalledTimes(1));

    const body = apiMock.entityWriteFile.mock.calls[0][3];
    // The YAML frontmatter is double-quoted and YAML doesn't treat
    // backticks specially, so leave those alone. But the markdown
    // body MUST NOT contain three consecutive backticks — they would
    // close the implicit code fence and swallow the rest of the doc
    // on first paint. Extract the body (everything after the closing
    // `---`) and assert on that slice.
    const fmCloseIdx = body.indexOf("\n---\n", 4);
    expect(fmCloseIdx).toBeGreaterThan(-1);
    const mdBody = body.slice(fmCloseIdx + 5);
    expect(mdBody).not.toContain("```");
  });

  it("surfaces a toast when there is no active Claude session", async () => {
    activeSessionMock.writeToActiveSession.mockResolvedValue(false);
    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "stranded" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "List open tickets." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    // File still gets created — losing the in-session handoff doesn't
    // throw away the user's intent or filename.
    await waitFor(() => expect(apiMock.entityWriteFile).toHaveBeenCalledTimes(1));

    // Toast surfaces the failed handoff so the user knows to start a
    // Claude session before expecting the template to fill in.
    await waitFor(() =>
      expect(
        screen.getByText(/no claude session is active/i),
      ).toBeInTheDocument(),
    );
  });
});
