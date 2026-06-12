# PIN-6608: Claude terminal readability revisit — Implementation plan

**Ticket:** [PIN-6608](https://linear.app/pinkfish/issue/PIN-6608/openit-fix-pty-resize-artifacts-in-the-claude-pane)
**Date:** 2026-06-05
**Repo:** `openit-app` (primary)
**References:** `/web` (plugin home, FE patterns), `/platform` (MCPs, services), `/firebase-helpers` (resource APIs), `/pinkfish-connections` (proxy)
**Predecessor:** PIN-6608 original resize pass

---

## 1. Technical investigation

Latest Slack evidence says the Claude pane readability problem is still high priority after the first resize work: "this is the number 1 issue right now - i go back to Zed b/c i cant read the output." That message was in the thread for the Claude-output formatting/readability screenshots, after prior resize/newline fixes had already landed.

Current state:

1. `ChatPane` constructs the xterm terminal at `src/shell/ChatPane.tsx:181`-`241`.
2. The terminal uses a long Nerd Font fallback stack and `fontSize: 13` at `src/shell/ChatPane.tsx:181`-`185`.
3. The xterm theme is hard-coded inside `ChatPane` at `src/shell/ChatPane.tsx:215`-`239`, with warm dark background `#1a140e` and foreground `#f0e7d3`.
4. Resize handling now rAF-throttles `fit.fit()` and debounces the final `ptyResize` at `src/shell/ChatPane.tsx:492`-`551`. It only clears the visible viewport, not scrollback, at `src/shell/ChatPane.tsx:520`-`522`.
5. Re-revealing a hidden tab refits, clears the viewport, and sends Ctrl+L at `src/shell/ChatPane.tsx:601`-`610`.
6. Tests cover spawn, resize coalescing, hidden-pane resize suppression, and rAF cancellation in `src/shell/ChatPane.test.tsx`.
7. The right pane provides a separate "dark theatre" around xterm at `src/App.css:2131`-`2153`.
8. The right-pane overlay at `src/App.css:2155`-`2165` draws a radial wash and dotted texture over the terminal area because the pseudo-element sits above the pane background and below children. Even subtle visual texture can hurt terminal text clarity and screenshots.
9. The shell sets the right pane minimum at 26% of a 1080px window, about 281px, at `src/shell/Shell.tsx:38`-`45`. That may be mathematically enough for xterm columns, but it is tight for Claude's formatted output and tool blocks.

What the prior `PIN-6608` branch covered:

- The original branch focused on resize artifacts: settle handling, throttled resize, and buffer clearing.
- Main now contains later refinements that preserve scrollback and avoid hidden-pane blanking.
- The latest complaint is broader than "resize artifact"; it is that output is hard to read in daily use.

Root cause hypothesis: the current implementation has reasonable PTY resize mechanics, but no explicit readability acceptance criteria or visual verification. The likely product-level issues are dense font sizing/line height, right-pane visual texture behind terminal output, cramped default/minimum pane width, and lack of regression screenshots across desktop/mobile-ish constrained widths.

Screenshot note:

- Slack file metadata was available during triage, but the MCP did not expose image bytes and raw file URLs redirected to Slack login. Treat the Slack text/thread evidence as authoritative and verify with fresh local screenshots before implementation is considered done.

Cross-repo reach:

- No plugin scripts, generated clients, or service endpoints are touched.
- `/web` mirror work is not required.

## 2. Proposed solution

Do a targeted readability pass that is measurable and screenshot-verified, not another broad terminal rewrite.

Approach:

- Move terminal visual constants into named local constants so font size, line height, letter spacing, and theme choices are explicit and testable.
- Increase terminal readability conservatively: likely `fontSize` from 13 to 14 and a stable `lineHeight`, while keeping enough columns in the right pane.
- Remove or suppress the decorative right-pane pseudo-element behind xterm content so terminal text sits on a flat background.
- Review right pane minimum/default width. If increasing the minimum materially improves Claude output without breaking the three-pane layout, adjust it with comments and visual checks.
- Add test coverage for terminal options that matter to readability and keep existing resize tests.
- Add a local screenshot verification workflow for the Claude pane at normal and constrained widths. The final PR should include before/after screenshots or notes.

| File | Change |
| --- | --- |
| `src/shell/ChatPane.tsx` | Extract terminal option constants; tune font size/line height/theme only after screenshot comparison; keep existing resize behavior unless verification shows a specific resize bug. |
| `src/shell/ChatPane.test.tsx` | Extend fake terminal capture to assert readability-relevant options and preserve resize invariants. |
| `src/App.css` | Remove or neutralize the right-pane decorative overlay behind xterm; add any needed flat terminal host styling. |
| `src/shell/Shell.tsx` | Consider a small right-pane min/default adjustment if screenshot checks show the current width is too cramped. |
| `auto-dev/explorations/2026-06-05-openit-feedback-triage.md` | Append the revisit outcome once implemented and verified. |

Unit tests:

- `ChatPane.test.tsx`: assert terminal construction includes the chosen font size, line height, and scrollback; preserve resize coalescing, hidden-pane suppression, and rAF cancellation tests.
- If `Shell.tsx` width constants change, add or extend a focused test only if there is an existing shell layout test pattern that can observe those constants without brittle DOM measurement.

Manual scenarios:

- Launch the app and capture the Claude pane at the default window size.
- Resize the right pane narrower/wider while Claude is producing formatted output; verify no stale glyphs and no overlapping tool text.
- Switch between Claude tabs after formatted output exists; verify re-reveal is readable and scrollback is not destroyed.
- Verify the pane at the minimum app width on macOS.
- Verify the same terminal behavior on Windows/WebView2 before release, especially font fallback and Ctrl+L/reveal behavior.

## 3. Implementation checklist

### Step 1 — Baseline and constants

- [ ] Capture current Claude pane screenshots at default and constrained widths.
- [ ] Extract terminal visual constants from inline `new Terminal(...)` options.
- [ ] Add unit coverage for readability-relevant terminal options.

### Step 2 — Visual clarity

- [ ] Remove terminal-background texture/noise from the right pane or keep it away from xterm content.
- [ ] Tune font size/line height/theme based on screenshots, not guesswork.
- [ ] Recheck right-pane minimum/default widths and adjust only if the visual evidence supports it.

### Step 3 — Regression checks

- [ ] Run targeted ChatPane tests.
- [ ] Run `npm run build`.
- [ ] Capture after screenshots for default, constrained, and tab re-reveal states.
- [ ] Update the triage note with the final decision and verification evidence.

## 4. Approval checkpoint

Stop here and wait for human review/approval before Stage 03 implementation.
