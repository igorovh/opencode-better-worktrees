/**
 * Tool registration for the V2 `ctx.tool.transform` API.
 *
 * The plugin beta's `Tool.Info` input type is a generic union
 * (`Schema.Codec | StandardSchemaV1 | JsonSchema`) that does not cleanly admit
 * plain JSON-Schema literals authored outside its own modules. Tools here are
 * fully typed through `WorktreeTool`; the single cast below is the only place
 * where that friction is bridged, and it is runtime-safe: the object shape is
 * exactly the documented `draft.add({ name, description, input, execute })`
 * contract with plain JSON Schema.
 */

import type { ToolDeps, WorktreeTool } from "./shared.ts"
import { buildCreateTool } from "./create.ts"
import { buildListTool } from "./list.ts"
import { buildStatusTool } from "./status.ts"
import { buildUseTool } from "./use.ts"
import { buildSpawnAgentTool } from "./spawn-agent.ts"
import { buildRemoveTool } from "./remove.ts"
import { buildRefreshTool } from "./refresh.ts"
import { buildDelegateTool } from "./delegate.ts"

interface ToolDraftLike {
  add(tool: WorktreeTool): void
}

export function buildTools(deps: ToolDeps): WorktreeTool[] {
  return [
    buildCreateTool(deps),
    buildListTool(deps),
    buildStatusTool(deps),
    buildUseTool(deps),
    buildSpawnAgentTool(deps),
    buildRemoveTool(deps),
    buildRefreshTool(deps),
    buildDelegateTool(deps),
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
