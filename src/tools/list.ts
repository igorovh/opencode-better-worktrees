import type { ToolDeps, WorktreeTool } from "./shared.ts"
import { basenameOf, samePath } from "../utils/paths.ts"
import { defineTool, summarizeChanges } from "./shared.ts"

export function buildListTool(deps: ToolDeps): WorktreeTool {
  return defineTool({
    name: "worktree_list",
    description:
      "List every OpenCode-managed Git worktree for the current project, including the project root. " +
      "Use this to see which isolated workspaces exist before creating, using, or removing " +
      "a worktree, or when the user asks about active worktrees. Each entry reports the absolute directory, " +
      "the native strategy used to manage it, and (with includeStatus) its branch and pending changes. " +
      "Information comes from OpenCode's native Worktree API, not from parsing git output.",
    input: {
      type: "object",
      properties: {
        includeStatus: {
          type: "boolean",
          description: "Also include branch and uncommitted-change information for each worktree (slightly slower).",
        },
      },
      additionalProperties: false,
    },
    output: { type: "object" },
    async execute(rawInput) {
      const input = (rawInput ?? {}) as { includeStatus?: boolean }
      const entries = await deps.worktrees.list({ projectID: deps.project.id })

      const worktrees = entries
        .map((entry) => ({
          directory: entry.directory,
          name: basenameOf(entry.directory),
          // Entries without a strategy are the project's root working copy.
          kind: entry.strategy ? ("managed" as const) : ("root" as const),
          strategy: entry.strategy,
        }))
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "root" ? -1 : 1))

      if (input.includeStatus) {
        const enriched = await Promise.all(
          worktrees.map(async (entry) => {
            try {
              const [branch, changes] = await Promise.all([deps.vcs.info(entry.directory), deps.vcs.status(entry.directory)])
              return { ...entry, branch: branch?.current, ...summarizeChanges(changes), clean: changes.length === 0 }
            } catch {
              return entry
            }
          }),
        )
        const output = { projectID: deps.project.id, worktrees: enriched }
        return {
          output,
          content: [
            {
              type: "text" as const,
              text: `Found ${worktrees.length} worktree(s) for this project.\n${JSON.stringify(output, null, 2)}`,
            },
          ],
        }
      }

      const output = { projectID: deps.project.id, worktrees }
      return {
        output,
        content: [
          {
            type: "text" as const,
            text: `Found ${worktrees.length} worktree(s) for this project.\n${JSON.stringify(output, null, 2)}`,
          },
        ],
      }
    },
  })
}

