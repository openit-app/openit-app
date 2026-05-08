import { fsRead } from "../../../lib/api";
import type { ViewerSource } from "../../viewerTypes";

/**
 * agents/<name>.md -- render as a regular file (V3 agents are plain
 * markdown -- the full viewer pipeline handles View/Edit/Raw).
 */
export function resolveAgentMd(path: string): ViewerSource {
  return { kind: "file", path };
}

/**
 * agents/<name>.json -- agent (legacy V1/V2, still renders)
 */
export async function resolveAgentJson(path: string): Promise<ViewerSource> {
  try {
    const raw = await fsRead(path);
    const agent = JSON.parse(raw);
    return { kind: "agent", agent, path };
  } catch {
    return { kind: "file", path };
  }
}

/**
 * workflows/<name>.json -- workflow
 */
export async function resolveWorkflow(path: string): Promise<ViewerSource> {
  try {
    const raw = await fsRead(path);
    const workflow = JSON.parse(raw);
    return { kind: "workflow", workflow, path };
  } catch {
    return { kind: "file", path };
  }
}
