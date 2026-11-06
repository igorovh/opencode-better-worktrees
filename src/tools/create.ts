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
      "worktree_use before editing files.",
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
            'Optional branch name to create inside the worktree before committing. Defaults to the configured prefix ' +
            'plus the name (e.g. "agent/auth-refactor"). The native API creates worktrees in detached HEAD, so run ' +
            '`git switch -c <branch>` inside the worktree before the first commit.',
        },
        from: {
          type: "string",
          description: 'Optional existing Git ref to detach the worktree at (e.g. "main" or a commit hash). Defaults to HEAD.',
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
          `Created managed worktree "${result.name}" at ${result.directory}. It starts in detached HEAD: run ` +
            `\`git switch -c ${result.branch}\` inside it before committing. Use worktree_use to move this session there.`,
          { ...result },
        ),
        metadata: { worktree: result.directory },
      }
    },
  })
}
