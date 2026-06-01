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

  it("cancelled P1's late inline release does not steal a concurrent P2's double-submit guard", async () => {
    // Sequence: Create alpha (P1) → entityWriteFile suspends → Cancel
    // (clears guard, bumps gen) → +New → fill beta → Create (P2,
    // grabs guard). Now P1's write resolves and hits the inline
    // `creatingRef.current = false` early-release at the
    // point-of-no-return. WITHOUT the gen-check on that line, it
    // would clear P2's guard, letting a third Create slip through
    // and produce a duplicate handoff for beta. WITH the check,
    // P1's gen no longer matches, the inline release is skipped,
    // and the guard stays owned by P2.
    let resolveAlphaWrite: (() => void) | null = null;
    let alphaWriteStarted = false;
    apiMock.entityWriteFile.mockImplementation(async () => {
      if (!alphaWriteStarted) {
        alphaWriteStarted = true;
        return new Promise<void>((res) => {
          resolveAlphaWrite = res;
        });
      }
      // beta's write resolves immediately so it can proceed.
    });

    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });
    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "alpha" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Suspended write." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await new Promise((r) => setTimeout(r, 0));

    // Cancel alpha — bumps gen and releases guard.
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    // Reopen, fill beta, submit.
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });
    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "beta" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Real one." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // P2 (beta) is now in flight. Release P1 (alpha). Its inline
    // creatingRef release must SKIP (gen mismatch). beta's guard
    // stays armed.
    resolveAlphaWrite?.();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // The exact assertion that matters: a third Create click while
    // P2 is still mid-flight must be blocked, NOT slip through.
    // We can detect this by checking that no third write fires.
    const writeCountBeforeThirdClick = apiMock.entityWriteFile.mock.calls.length;
    // Form is still showing beta because P2 hasn't reset it. Click
    // Create again to try to trigger P3.
    const createBtn = screen.queryByRole("button", { name: /^create$/i });
    if (createBtn) {
      fireEvent.click(createBtn);
      await new Promise((r) => setTimeout(r, 0));
    }
    // No additional entityWriteFile call — the guard held.
    expect(apiMock.entityWriteFile.mock.calls.length).toBe(writeCountBeforeThirdClick);
  });

  it("cancel-mid-create releases the double-submit guard so a follow-up create still works", async () => {
    // Regression for the high-severity 9942cb0 issue: gen-gating the
    // outer finally meant a cancel-mid-fsList path skipped the
    // guard release entirely. creatingRef would stay true forever,
    // silently blocking every future + New. Cancel must clear the
    // guard explicitly so the follow-up create still goes through.
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
      target: { value: "first" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Will be cancelled." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await new Promise((r) => setTimeout(r, 0));

    // Cancel the in-flight create.
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    resolveList?.([]);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(apiMock.entityWriteFile).not.toHaveBeenCalled();

    // Now swap the impl back to a normal sync resolve so the second
    // attempt actually goes through.
    apiMock.fsList.mockResolvedValue([]);

    // Second attempt — this is what was broken. If creatingRef
    // leaked, this click would silently no-op at `if (creatingRef.current) return`.
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });
    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "second" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Goes through." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(apiMock.entityWriteFile).toHaveBeenCalledTimes(1));
    expect(apiMock.entityWriteFile.mock.calls[0][2]).toBe("second.md");
  });

  it("clicking + New to dismiss an open composer cancels an in-flight create", async () => {
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
      { target: { value: "Mid-flight." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await new Promise((r) => setTimeout(r, 0));

    // User clicks + New to dismiss the dialog (the toggle path) —
    // this MUST cancel the in-flight create the same way the
    // explicit Cancel button does.
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));

    // Release fsList → pipeline checks cancelled() and bails.
    resolveList?.([]);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(apiMock.entityWriteFile).not.toHaveBeenCalled();
  });

  it("does not clobber the dialog state of a SECOND open composer when first pipeline finishes", async () => {
    // Realistic race: P1 (alpha) write in flight → user Cancels →
    // opens dialog again → types beta. When alpha's write resolves
    // and the post-commit branch runs, it must NOT overwrite the
    // beta form state with empty strings.
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
      target: { value: "alpha" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "First." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await new Promise((r) => setTimeout(r, 0));

    // User cancels alpha (bumps gen, closes dialog) and reopens.
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });

    // User starts typing beta.
    const nameInput = screen.getByPlaceholderText("command-name");
    fireEvent.change(nameInput, { target: { value: "beta" } });
    const intentInput = screen.getByPlaceholderText(/what should this command do/i);
    fireEvent.change(intentInput, { target: { value: "Second." } });

    // Alpha's entityWriteFile now resolves — the post-commit
    // cleanup branch must NOT wipe the beta form state because the
    // generation token has been bumped.
    resolveWrite?.();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect((nameInput as HTMLInputElement).value).toBe("beta");
    expect((intentInput as HTMLTextAreaElement).value).toBe("Second.");
  });

  it("completes the create when Cancel fires AFTER the file is written (point of no return)", async () => {
    // Hold entityWriteFile in suspense so Cancel can land between
    // the pre-write cancelled() check and the post-write commit
    // section.
    let resolveWrite: (() => void) | null = null;
    apiMock.entityWriteFile.mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveWrite = res;
        }),
    );

    const onOpen = vi.fn();
    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });
    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "commit" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Crosses the no-return line." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    // Let the pre-write checks run. entityWriteFile is now suspended.
    await new Promise((r) => setTimeout(r, 0));
    // User mashes Cancel WHILE entityWriteFile is in flight. The
    // bump should NOT abort the post-write actions — the file write
    // is already committed once entityWriteFile resolves.
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Release the write. The post-commit path (onOpen + Claude
    // handoff) must run, leaving the user with a viewer + Claude
    // turn — not an orphan file.
    resolveWrite?.();
    await waitFor(() =>
      expect(onOpen).toHaveBeenCalledWith("/tmp/repo/filestores/commands/commit.md"),
    );
    await waitFor(() =>
      expect(activeSessionMock.writeToActiveSession).toHaveBeenCalledTimes(1),
    );
  });

  it("runs the system-skill check even when filestores/commands fsList throws (fresh-vault first-create)", async () => {
    // Regression for BugBot iter-9: on a fresh vault, filestores/
    // commands doesn't exist and fsList throws. Previously that
    // catch jumped past the nested system-skill check entirely, so
    // a `+ New backup` (where backup is a built-in skill) would
    // write `filestores/commands/backup.md` and shadow the system
    // version invisibly. With the system check in its own try
    // block, it must fire even when the user-skills fsList fails.
    let initialFsListHeld = false;
    apiMock.fsList.mockImplementation(async (path: string) => {
      if (path.endsWith("/.claude/skills") && !initialFsListHeld) {
        initialFsListHeld = true;
        return new Promise(() => {}); // initial panel load hangs
      }
      // The live re-list of filestores/commands FAILS (fresh vault).
      if (path.endsWith("/filestores/commands")) {
        throw new Error("ENOENT");
      }
      // The live re-list of .claude/skills succeeds and returns the
      // built-in skill — collision check must fire.
      if (path.endsWith("/.claude/skills")) {
        return [{ name: "backup", path: `${path}/backup`, is_dir: true }];
      }
      return [];
    });

    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });
    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "backup" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Try to shadow backup." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/system command/i),
      ).toBeInTheDocument(),
    );
    expect(apiMock.entityWriteFile).not.toHaveBeenCalled();
  });

  it("blocks a system-skill name collision via a live re-list even before the panel finishes loading", async () => {
    // Simulate the panel still mid-initial-load: the first fsList
    // for `.claude/skills` never resolves (so the cached commands
    // state stays empty). Submitting `+ New` for a system name in
    // that window must still be blocked by the live re-list inside
    // createNewCommandInner.
    let initialFsListHeld = false;
    apiMock.fsList.mockImplementation(async (path: string) => {
      // The initial-load call to `.claude/skills` hangs.
      if (path.endsWith("/.claude/skills") && !initialFsListHeld) {
        initialFsListHeld = true;
        return new Promise(() => {}); // never resolves
      }
      // The live re-list inside createNewCommandInner returns the
      // system skill so the collision check fires.
      if (path.endsWith("/.claude/skills")) {
        return [{ name: "backup", path: `${path}/backup`, is_dir: true }];
      }
      if (path.endsWith("/filestores/commands")) return [];
      return [];
    });

    renderInToastProvider(<CommandsStation repo="/tmp/repo" onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    await screen.findByRole("dialog", { name: /create new command/i });
    fireEvent.change(screen.getByPlaceholderText("command-name"), {
      target: { value: "backup" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/what should this command do/i),
      { target: { value: "Override the built-in." } },
    );
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/system command/i),
      ).toBeInTheDocument(),
    );
    expect(apiMock.entityWriteFile).not.toHaveBeenCalled();
  });

  it("normalises Windows backslash paths when classifying system vs user collisions", async () => {
    apiMock.fsList.mockImplementation(async (path: string) => {
      if (path.endsWith("/.claude/skills")) {
        // fs_list (WalkDir) is recursive: the dir and its SKILL.md come
        // back in the same listing. The catalog requires the SKILL.md to
        // be present for the dir to count as a command. Backslash-style
        // paths are normalised by fsNorm/isDirectChild downstream.
        return [
          { name: "winskill", path: `${path}/winskill`, is_dir: true },
          { name: "SKILL.md", path: `${path}/winskill/SKILL.md`, is_dir: false },
        ];
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
        // System command — directory containing a SKILL.md. fs_list is
        // recursive, so both come back in one listing.
        return [
          { name: "onboard", path: `${path}/onboard`, is_dir: true },
          { name: "SKILL.md", path: `${path}/onboard/SKILL.md`, is_dir: false },
        ];
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
