/// `.openit/tasks-stages.json` — user-configurable Kanban column list.
///
/// The Tasks viewer renders one column per entry in `stages`, in the
/// order listed. A task's frontmatter `status` field is matched against
/// the stage list as a freeform string. Stages that don't match any
/// task are still rendered (empty column). Tasks whose status doesn't
/// match any stage fall into a synthetic "Unsorted" column appended to
/// the right — and that column is only shown when non-empty.
///
/// There is intentionally no in-app UI for editing this file. The user
/// asks Claude Code ("add a Blocked stage between In Progress and
/// Complete") and CC rewrites the file. The viewer subscribes to
/// `fsTick` so out-of-band edits flow in without a restart.

import { fsRead, entityWriteFile } from "./api";

export const DEFAULT_STAGES: readonly string[] = ["Todo", "In Progress", "Complete"];

/// Synthetic stage for tasks whose `status` doesn't match any
/// configured stage. Never written to disk and never offered as a drop
/// target — the column appears at the right edge only when at least
/// one task lands in it so a typo doesn't silently drop tasks.
export const UNSORTED_STAGE = "Unsorted";

const CONFIG_SUBDIR = ".openit";
const CONFIG_FILENAME = "tasks-stages.json";
const CONFIG_RELPATH = `${CONFIG_SUBDIR}/${CONFIG_FILENAME}`;

export interface TaskStagesConfig {
  stages: string[];
}

/// Parse a parsed-JSON blob into a stages config. Returns `null` when
/// the shape doesn't match so the caller can fall back to defaults
/// rather than render a broken board.
function parseStagesConfig(raw: unknown): TaskStagesConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const stages = (raw as { stages?: unknown }).stages;
  if (!Array.isArray(stages)) return null;
  const cleaned: string[] = [];
  for (const s of stages) {
    if (typeof s !== "string") continue;
    const trimmed = s.trim();
    if (!trimmed) continue;
    // De-duplicate so two identical stage names don't render two
    // columns competing for the same set of tasks.
    if (cleaned.includes(trimmed)) continue;
    cleaned.push(trimmed);
  }
  if (cleaned.length === 0) return null;
  return { stages: cleaned };
}

/// Load `.openit/tasks-stages.json`. On first launch (file missing) or
/// any parse failure, falls back to `DEFAULT_STAGES` in-memory and
/// best-effort seeds the file so the user has something to edit.
/// Seeding failure is non-fatal — the next call just retries.
export async function loadStages(repo: string): Promise<string[]> {
  try {
    const raw = await fsRead(`${repo}/${CONFIG_RELPATH}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [...DEFAULT_STAGES];
    }
    const config = parseStagesConfig(parsed);
    if (!config) return [...DEFAULT_STAGES];
    return config.stages;
  } catch {
    // File doesn't exist — seed defaults and return them. Don't await;
    // the read path doesn't depend on the seed write completing.
    saveStages(repo, [...DEFAULT_STAGES]).catch((err) => {
      console.warn("[taskStages] seed write failed:", err);
    });
    return [...DEFAULT_STAGES];
  }
}

/// Overwrite `.openit/tasks-stages.json` with the given stage list.
/// Empty stages are skipped; duplicates are collapsed; if the cleaned
/// list is empty, the defaults are written instead so the file never
/// lands in a state that renders zero columns.
export async function saveStages(repo: string, stages: string[]): Promise<void> {
  const cleaned: string[] = [];
  for (const s of stages) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    if (cleaned.includes(trimmed)) continue;
    cleaned.push(trimmed);
  }
  const payload: TaskStagesConfig = {
    stages: cleaned.length > 0 ? cleaned : [...DEFAULT_STAGES],
  };
  await entityWriteFile(
    repo,
    CONFIG_SUBDIR,
    CONFIG_FILENAME,
    `${JSON.stringify(payload, null, 2)}\n`,
  );
}

/// Given a task's freeform `status` field and the configured stage
/// list, return the stage name the task belongs in. Match is
/// case-insensitive and whitespace-tolerant. Returns `UNSORTED_STAGE`
/// for any status that fails to match — the caller renders that bucket
/// only when non-empty.
export function stageForStatus(status: string, stages: string[]): string {
  const target = status.trim().toLowerCase();
  if (!target) return UNSORTED_STAGE;
  for (const stage of stages) {
    if (stage.trim().toLowerCase() === target) return stage;
  }
  return UNSORTED_STAGE;
}

/// Return the next stage in the configured rotation, wrapping at the
/// end. Used by the keyboard / fallback status-cycle path. Unknown
/// current stage (e.g. an "Unsorted" task) returns the first
/// configured stage so the rotation has a well-defined starting point.
export function nextStage(current: string, stages: string[]): string {
  if (stages.length === 0) return current;
  const idx = stages.findIndex((s) => s.trim().toLowerCase() === current.trim().toLowerCase());
  if (idx === -1) return stages[0];
  return stages[(idx + 1) % stages.length];
}
