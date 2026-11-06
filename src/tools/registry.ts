import type { ToolDeps, WorktreeTool } from "./shared.ts"
import { buildCreateTool } from "./create.ts"
import { buildListTool } from "./list.ts"
import { buildStatusTool } from "./status.ts"
import { buildUseTool } from "./use.ts"
import { buildRemoveTool } from "./remove.ts"
import { buildRefreshTool } from "./refresh.ts"

// The plugin's `Tool.Info` input union does not admit plain JSON Schema literals; this draft shape bridges it.
interface ToolDraftLike {
  add(tool: WorktreeTool): void
}

export function buildTools(deps: ToolDeps): WorktreeTool[] {
  return [
    buildCreateTool(deps),
    buildListTool(deps),
    buildStatusTool(deps),
    buildUseTool(deps),
    buildRemoveTool(deps),
    buildRefreshTool(deps),
  ]
}

export async function registerTools(register: (transform: (draft: ToolDraftLike) => void) => Promise<unknown>, tools: WorktreeTool[]): Promise<void> {
  await register((draft) => {
    for (const tool of tools) {
      draft.add(tool)
    }
  })
}

export type { ToolDeps }
