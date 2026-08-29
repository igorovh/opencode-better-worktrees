/**
 * `worktree_create` — create an isolated OpenCode-managed Git worktree.
 */

import { InvalidInputError } from "../utils/errors.ts"
import type { ToolDeps, WorktreeTool } from "./shared.ts"
import { createWorktree, defineTool, withJson } from "./shared.ts"

export function buildCreateTool(deps: ToolDeps): WorktreeTool {
  return defineTool({
    name: "worktree_create",
    description:
      "Create an isolated OpenCode-managed Git worktree for implementation work that should not modify the " +
      "current working tree. Use this when the user asks to work in a separate workspace, when experimenting " +
      "with risky changes, or when independent tasks should be isolated. OpenCode itself creates the worktree " +
      "through its native Worktree API (including any configured setup scripts); never run git worktree " +
      "commands manually. After creating a worktree for your own work, move the current session into it with " +
      "worktree_use before editing files, or delegate parallel tasks with worktree_delegate.",
    input: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Short unique name for the worktree (letters, digits, dots, underscores, dashes; no slashes). " +
            "Example: \"auth-refactor\". Used for the directory name and, by default, the branch name.",
        },
        branch: {
          type: "string",
          description:
            'Optional Git branch name for the new worktree. Defaults to the configured prefix plus the name (e.g. "agent/auth-refactor").',
        },
        from: {
          type: "string",
          description: 'Optional Git ref to base the new worktree on (e.g. "main" or a commit hash). Defaults to the repository default.',
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    output: { type: "object" },
    async execute(rawInput) {
      const input = (rawInput ?? {}) as { name?: string; branch?: string; from?: string }
      if (typeof input.name !== "string") {
        throw new InvalidInputError('The "name" input is required.')
      }
      const result = await createWorktree(deps, { name: input.name, branch: input.branch, from: input.from })
      return {
        output: { ...result },
        content: withJson(
          `Created managed worktree "${result.name}" at ${result.directory}` +
            (result.branch ? ` on branch "${result.branch}"` : "") +
            ". Use worktree_use to move this session there, or worktree_spawn_agent to delegate work to it.",
          { ...result },
        ),
        metadata: { worktree: result.directory },
      }
    },
  })
}

export { createWorktree }
