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

  it("guards against a double-click on Create — only one file write + one Claude handoff per submit", async () => {
    // Keep entityWriteFile pending so a fast second click lands
    // while the first is still in flight.
    let resolveWrite: (() => void) | null = null;
    apiMock.entityWriteFile.mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveWrite = res;
        }),
    );

    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "racey" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Race." } },
    );

    const createBtn = screen.getByRole("button", { name: /^create$/i });
    // Double-click as fast as React can dispatch — second click must
    // be absorbed by the in-flight guard.
    fireEvent.click(createBtn);
    fireEvent.click(createBtn);
    fireEvent.click(createBtn);

    // Let microtasks flush so all three click handlers' async bodies
    // hit the guard.
    await new Promise((r) => setTimeout(r, 0));
    expect(apiMock.entityWriteFile).toHaveBeenCalledTimes(1);

    // Finish the write and let writeToActiveSession run.
    resolveWrite?.();
    await waitFor(() =>
      expect(activeSessionMock.writeToActiveSession).toHaveBeenCalledTimes(1),
    );
  });

  it("refuses to clobber an existing command and toasts a collision warning", async () => {
    // Seed an existing /deploy command — fsList returns the dir,
    // fsRead returns the body so it shows up in the panel state.
    apiMock.fsList.mockImplementation(async (path: string) => {
      if (path.endsWith("/filestores/commands")) {
        return [
          { name: "deploy.md", path: `${path}/deploy.md`, is_dir: false },
        ];
      }
      return [];
    });
    apiMock.fsRead.mockResolvedValue("# /deploy\n\nDescribe.");

    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    // Wait for the panel to enumerate the existing command.
    await screen.findByText(/deploy/);

    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "deploy" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Different goal." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    // No write to disk, no Claude handoff — existing /deploy is safe.
    await waitFor(() =>
      expect(
        screen.getByText(/already exists/i),
      ).toBeInTheDocument(),
    );
    expect(apiMock.entityWriteFile).not.toHaveBeenCalled();
    expect(activeSessionMock.writeToActiveSession).not.toHaveBeenCalled();
  });

  it("cancels an in-flight create when the user hits Cancel during fsList", async () => {
    // Hold the live re-list in suspense so the user can Cancel
    // between the cached collision check and the disk write.
    let resolveList: ((nodes: { name: string; path: string; is_dir: boolean }[]) => void) | null = null;
    apiMock.fsList.mockImplementation(
      () =>
        new Promise((res) => {
          resolveList = res;
        }),
    );

    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "racey" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "About to be cancelled." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    // Cancel mid-flight (the dialog is still up while fsList hangs;
    // hitting Cancel must abort the inner pipeline).
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Release the suspended fsList → the pipeline must NOT proceed
    // to entityWriteFile because the generation has bumped.
    resolveList?.([]);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(apiMock.entityWriteFile).not.toHaveBeenCalled();
    expect(activeSessionMock.writeToActiveSession).not.toHaveBeenCalled();
  });

  it("normalises Windows backslash paths when classifying system vs user collisions", async () => {
    apiMock.fsList.mockImplementation(async (path: string) => {
      if (path.endsWith("/.claude/skills")) {
        return [{ name: "winskill", path: `${path}/winskill`, is_dir: true }];
      }
      // Simulate fsList returning backslash-style paths the way it
      // does on Windows.
      if (path.endsWith("/.claude/skills/winskill")) {
        return [{
          name: "SKILL.md",
          path: "C:\\Users\\me\\repo\\.claude\\skills\\winskill\\SKILL.md",
          is_dir: false,
        }];
      }
      return [];
    });
    apiMock.fsRead.mockResolvedValue("---\ndescription: \"Win system skill\"\n---\n");

    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    await screen.findByText(/win system skill/i);

    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });
    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "winskill" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Custom win." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/system command/i),
      ).toBeInTheDocument(),
    );
  });

  it("catches case-variant collisions (HFS+/NTFS are case-insensitive)", async () => {
    apiMock.fsList.mockImplementation(async (path: string) => {
      if (path.endsWith("/filestores/commands")) {
        // Existing entry is uppercase — on macOS HFS+ this is the
        // same file as the lowercased slug, so the write must be
        // refused even though strict equality would let it through.
        return [{ name: "Backup.md", path: `${path}/Backup.md`, is_dir: false }];
      }
      return [];
    });
    apiMock.fsRead.mockResolvedValue("---\ndescription: \"Existing backup\"\n---\n");

    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    await screen.findByText(/existing backup/i);

    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });
    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "backup" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "New backup." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/already exists/i),
      ).toBeInTheDocument(),
    );
    expect(apiMock.entityWriteFile).not.toHaveBeenCalled();
  });

  it("distinguishes a system-command collision from a user-command collision in the toast", async () => {
    apiMock.fsList.mockImplementation(async (path: string) => {
      if (path.endsWith("/.claude/skills")) {
        // System command — directory containing a SKILL.md.
        return [{ name: "onboard", path: `${path}/onboard`, is_dir: true }];
      }
      if (path.endsWith("/.claude/skills/onboard")) {
        return [{ name: "SKILL.md", path: `${path}/SKILL.md`, is_dir: false }];
      }
      return [];
    });
    apiMock.fsRead.mockResolvedValue("---\ndescription: \"System onboard\"\n---\n");

    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    // Wait for the panel to enumerate the (system) command — the
    // description text is unique enough to disambiguate from the
    // bare `onboard` slug that appears in the card title too.
    await screen.findByText(/system onboard/i);

    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });
    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "onboard" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Custom onboard." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    // Toast must call out the system-command-reserved case so the
    // user doesn't go hunting under filestores/commands/ for a file
    // that doesn't exist there.
    await waitFor(() =>
      expect(
        screen.getByText(/system command/i),
      ).toBeInTheDocument(),
    );
    expect(apiMock.entityWriteFile).not.toHaveBeenCalled();
  });

  it("catches a TOCTOU collision created between the cached check and the disk write", async () => {
    // The cached commands state is empty (initial fsList for `.claude/skills`
    // and `filestores/commands` both return nothing). When the live
    // re-list runs inside createNewCommand, it returns the slug as if
    // another process created it in the meantime.
    let writeCheckCount = 0;
    apiMock.fsList.mockImplementation(async (path: string) => {
      if (path.endsWith("/filestores/commands")) {
        writeCheckCount += 1;
        // Initial load returns nothing; the in-flight re-list returns
        // a freshly-created file.
        if (writeCheckCount > 1) {
          return [{ name: "claimed.md", path: `${path}/claimed.md`, is_dir: false }];
        }
      }
      return [];
    });

    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });
    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "claimed" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Race with Claude." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/another process created/i),
      ).toBeInTheDocument(),
    );
    expect(apiMock.entityWriteFile).not.toHaveBeenCalled();
  });

  it("toasts a warning when Cmd/Ctrl+Enter is fired with empty intent (textarea bypass)", async () => {
    // Pre-fill the name so the validity gate on the keyboard shortcut
    // is the only thing standing between an empty intent and submit.
    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "named" },
    });
    const textarea = screen.getByPlaceholderText(/what should this command do/i);

    // Cmd+Enter with no intent → the textarea handler's canSubmit
    // gate refuses to invoke createNewCommand. No file, no toast yet.
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(apiMock.entityWriteFile).not.toHaveBeenCalled();
  });

  it("propagates entityWriteFile errors as a critical toast", async () => {
    apiMock.entityWriteFile.mockRejectedValue(new Error("disk full"));
    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "doomed" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Try and fail." } },
    );
    // Silence the expected console.error so test output stays clean.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/disk full/i),
      ).toBeInTheDocument(),
    );
    errSpy.mockRestore();
  });

  it("treats a writeToActiveSession throw the same as a no-session return", async () => {
    activeSessionMock.writeToActiveSession.mockRejectedValue(
      new Error("pty channel closed"),
    );
    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "threw" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Test." } },
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    // File still lands on disk — the failure is in the handoff, not
    // the write — and the user sees the same warn toast they would
    // for the "no active session" branch.
    await waitFor(() => expect(apiMock.entityWriteFile).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByText(/claude session not active/i),
      ).toBeInTheDocument(),
    );
    errSpy.mockRestore();
  });

  it("toasts a warning when the name slugs to empty (non-ASCII, punctuation)", async () => {
    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "中文" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Translate." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/letters, numbers, and dashes/i),
      ).toBeInTheDocument(),
    );
    expect(apiMock.entityWriteFile).not.toHaveBeenCalled();
  });

  it("escapes backslashes in the frontmatter description so YAML stays valid", async () => {
    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "winpath" },
    });
    // Trailing backslash is the killer — it'd escape the closing
    // quote and produce an unterminated YAML scalar.
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Sync C:\\Users\\me\\Desktop\\" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(apiMock.entityWriteFile).toHaveBeenCalledTimes(1));

    const body = apiMock.entityWriteFile.mock.calls[0][3];
    // Pull out just the description line of the frontmatter.
    const m = body.match(/^description:\s*"((?:[^"\\]|\\.)*)"\s*$/m);
    expect(m).not.toBeNull();
    // The closing `"` must be present — the regex above already
    // proves it parses as a complete double-quoted scalar.
  });

  it("escapes tilde fences in the intent body too (not just backticks)", async () => {
    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "tilded" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Run ~~~bash echo hi~~~ and report." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(apiMock.entityWriteFile).toHaveBeenCalledTimes(1));

    const body = apiMock.entityWriteFile.mock.calls[0][3];
    const fmCloseIdx = body.indexOf("\n---\n", 4);
    const mdBody = body.slice(fmCloseIdx + 5);
    // No three-in-a-row tildes survive in the body.
    expect(mdBody).not.toMatch(/~{3,}/);
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
    // Claude session before expecting the template to fill in. The
    // title must lead with the warning condition (not "Created /…")
    // so users skimming by tone+title don't dismiss it as success.
    await waitFor(() =>
      expect(
        screen.getByText(/claude session not active/i),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/no claude session is running/i),
    ).toBeInTheDocument();
  });
});
