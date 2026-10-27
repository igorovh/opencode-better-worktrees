/**
 * `worktree_delegate` — create a managed worktree AND delegate a task to a
 * new agent session inside it, in one step.
 *
 * This composes the exact same native primitives as `worktree_create` and
 * `worktree_spawn_agent` (shared `createWorktree`/`spawnWorktreeAgent`
 * operations); it adds no second worktree implementation.
 */

import { InvalidInputError } from "../utils/errors.ts"
import type { ToolDeps, WorktreeTool } from "./shared.ts"
import { createWorktree, defineTool, spawnWorktreeAgent, withJson } from "./shared.ts"
import { basenameOf } from "../utils/paths.ts"

export function buildDelegateTool(deps: ToolDeps): WorktreeTool {
  return defineTool({
    name: "worktree_delegate",
    description:
      "Create a new OpenCode-managed worktree and immediately delegate a task to a new agent session running " +
      "inside it. This is the one-step version of worktree_create followed by worktree_spawn_agent, and is the " +
      "preferred tool when the user asks to hand a task off to an isolated workspace (e.g. \"implement the " +
      "backend changes in a separate worktree\"). The new session's real location is the worktree, so all of " +
      "its normal tools operate there. Returns the worktree directory and the new sessionID. Use " +
      "worktree_list/worktree_status to track progress and worktree_remove to clean up when the user asks " +
      "and it is safe.",
    input: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Short unique name for the new worktree (letters, digits, dots, underscores, dashes; no slashes).",
        },
        task: {
          type: "string",
          description: "Full, self-contained task description for the delegated agent session.",
        },
        branch: {
          type: "string",
          description: "Optional Git branch name. Defaults to the configured prefix plus the name.",
        },
        from: {
          type: "string",
          description: "Optional Git ref to base the worktree on. Defaults to the repository default.",
        },
        agent: {
          type: "string",
          description: "Optional OpenCode agent name to run the delegated session with.",
        },
        wait: {
          type: "boolean",
          description: "Wait for the delegated session to finish before returning. Default: false (runs in parallel).",
        },
      },
      required: ["name", "task"],
      additionalProperties: false,
    },
    output: { type: "object" },
    async execute(rawInput) {
      const input = (rawInput ?? {}) as {
        name?: string
        task?: string
        branch?: string
        from?: string
        agent?: string
        wait?: boolean
      }
      if (typeof input.name !== "string") throw new InvalidInputError('The "name" input is required.')
      if (typeof input.task !== "string") throw new InvalidInputError('The "task" input is required.')

      const created = await createWorktree(deps, { name: input.name, branch: input.branch, from: input.from })
      const result = await spawnWorktreeAgent(deps, {
        worktree: { directory: created.directory, name: basenameOf(created.directory) },
        task: input.task,
        agent: input.agent,
        wait: input.wait,
      })
      const output = {
        name: created.name,
        directory: created.directory,
        branch: created.branch,
        from: created.from,
        sessionID: result.sessionID,
        task: result.task,
        started: true,
        waited: result.waited,
      }
      const human =
        `Delegated task to a new session (${result.sessionID}) in managed worktree "${created.name}" at ` +
        `${created.directory}` +
        (created.branch ? `. The worktree is detached; the session should run \`git switch -c ${created.branch}\` before committing.` : "") +
        (result.waited ? " The session finished its task." : " It is now working independently.")
      return { output, content: withJson(human, output), metadata: { sessionID: result.sessionID, worktree: created.directory } }
    },
  })
}
