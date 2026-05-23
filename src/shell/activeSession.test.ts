import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the ordering of every ptyWrite — that's the contract under
// test. We use a hoisted shared array so we can inspect it across
// concurrent writeToActiveSession invocations.
const ptyMock = vi.hoisted(() => ({
  events: [] as { sessionId: string; data: string; at: number }[],
  ptyWrite: vi.fn(),
}));

vi.mock("../lib/terminal", () => ({
  ptyWrite: ptyMock.ptyWrite,
}));

import { setActiveSession, clearActiveSession, writeToActiveSession } from "./activeSession";

describe("writeToActiveSession", () => {
  beforeEach(() => {
    ptyMock.events.length = 0;
    ptyMock.ptyWrite.mockReset();
    // Default impl: record the event and return immediately.
    ptyMock.ptyWrite.mockImplementation(async (sessionId: string, data: string) => {
      ptyMock.events.push({ sessionId, data, at: Date.now() });
    });
  });

  afterEach(() => {
    clearActiveSession("test-session");
  });

  it("returns false (and writes nothing) when no session is active", async () => {
    const result = await writeToActiveSession("hello\r");
    expect(result).toBe(false);
    expect(ptyMock.ptyWrite).not.toHaveBeenCalled();
  });

  it("splits body and enter into separate writes when text ends in a newline", async () => {
    setActiveSession("test-session");
    await writeToActiveSession("hello\r");
    const calls = ptyMock.ptyWrite.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(["test-session", "hello"]);
    expect(calls[1]).toEqual(["test-session", "\r"]);
  });

  it("serializes concurrent invocations so body+enter pairs do not interleave", async () => {
    setActiveSession("test-session");
    // Make each ptyWrite take 20ms so the race is observable.
    ptyMock.ptyWrite.mockImplementation((sessionId: string, data: string) => {
      ptyMock.events.push({ sessionId, data, at: Date.now() });
      return new Promise((res) => setTimeout(res, 20));
    });

    // Fire two writes back-to-back without awaiting the first.
    const a = writeToActiveSession("AAA\r");
    const b = writeToActiveSession("BBB\r");
    await Promise.all([a, b]);

    // The contract: A's body and enter must appear before B's body.
    // Without the serialization the order would be A.body, B.body,
    // A.enter, B.enter — producing "AAA + BBB + \r + \r" at the
    // terminal, one mangled merged submission.
    const seq = ptyMock.events.map((e) => e.data);
    const aBodyIdx = seq.indexOf("AAA");
    const aEnterIdx = seq.indexOf("\r", aBodyIdx);
    const bBodyIdx = seq.indexOf("BBB");
    expect(aBodyIdx).toBeLessThan(aEnterIdx);
    expect(aEnterIdx).toBeLessThan(bBodyIdx);
  });

  it("drops a queued write if the active session is cleared before it runs", async () => {
    setActiveSession("doomed");
    // Hold the first write so the chain queues the second behind it.
    let resolveFirst: (() => void) | null = null;
    ptyMock.ptyWrite.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          resolveFirst = res;
        }),
    );
    ptyMock.ptyWrite.mockImplementation(async (sessionId: string, data: string) => {
      ptyMock.events.push({ sessionId, data, at: Date.now() });
    });

    const a = writeToActiveSession("first\r");
    const b = writeToActiveSession("second\r");

    // While the first write is suspended, the active session is
    // cleared (Claude pane closed, etc.). The second queued write
    // must drop with false instead of writing to the stale id.
    await new Promise((r) => setTimeout(r, 0));
    clearActiveSession("doomed");
    resolveFirst?.();

    const errSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await a).toBe(true);
    expect(await b).toBe(false);
    errSpy.mockRestore();

    // The second write's payload never reached the PTY.
    expect(ptyMock.events.find((e) => e.data === "second")).toBeUndefined();
  });

  it("a thrown write in one caller does not poison the chain for the next", async () => {
    setActiveSession("test-session");
    let callCount = 0;
    ptyMock.ptyWrite.mockImplementation(async (_sessionId: string, data: string) => {
      callCount += 1;
      // Make the first call fail; subsequent calls succeed.
      if (callCount === 1) throw new Error("transient IPC failure");
      ptyMock.events.push({ sessionId: _sessionId, data, at: Date.now() });
    });

    await expect(writeToActiveSession("AAA\r")).rejects.toThrow(/transient/);
    // The next write must still go through — the chain must not be
    // stuck in a rejected state.
    await writeToActiveSession("BBB\r");
    expect(ptyMock.events.map((e) => e.data)).toEqual(["BBB", "\r"]);
  });
});
