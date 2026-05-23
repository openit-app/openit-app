/// Resolver for the top-level `tasks/` folder.
///
/// Routes a click on `<repo>/tasks` to the `tasks-list` viewer source
/// with the parsed task summaries. Individual `tasks/task-*.md` files
/// continue to resolve as ordinary markdown files (`kind: "file"`),
/// which the Viewer renders with the standard rendered / raw / edit
/// toggle — that's where users actually edit a task's body.

import { listTasks } from "../../../lib/tasks";
import type { ViewerSource } from "../../viewerTypes";

export async function resolveTasksList(repo: string): Promise<ViewerSource> {
  const tasks = await listTasks(repo);
  return { kind: "tasks-list", tasks };
}
