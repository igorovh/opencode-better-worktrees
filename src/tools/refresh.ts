import type { ToolDeps, WorktreeTool } from "./shared.ts"
import { defineTool, withJson } from "./shared.ts"

export function buildRefreshTool(deps: ToolDeps): WorktreeTool {
  return defineTool({
    name: "worktree_refresh",
    description:
      "Reconcile OpenCode's stored managed-worktree state with the project's Git repositories. Use this after " +
      "external changes to worktrees (a worktree was added or removed outside OpenCode, a branch was renamed, " +
      "or the list looks stale). Not needed during normal work. This only refreshes OpenCode's view; it never " +
      "modifies repository contents.",
    input: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    output: { type: "object" },
    async execute() {
      await deps.worktrees.refresh({ projectID: deps.project.id })
      const output = { refreshed: true, projectID: deps.project.id }
      return { output, content: withJson("Refreshed OpenCode's managed worktree state.", output) }
    },
  })
}
