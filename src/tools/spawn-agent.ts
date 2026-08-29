/**
 * `worktree_spawn_agent` — start a new OpenCode session inside a managed
 * worktree and assign it an independent task.
 */

import { InvalidInputError } from "../utils/errors.ts"
import type { ToolDeps, WorktreeTool } from "./shared.ts"
import { defineTool, resolveWorktree, spawnWorktreeAgent, withJson } from "./shared.ts"

export function buildSpawnAgentTool(deps: ToolDeps): WorktreeTool {
  return defineTool({
    name: "worktree_spawn_agent",
    description:
      "Start a new OpenCode agent session inside a managed worktree and assign it an independent task. Use " +
      "this for parallel implementation work or when multiple tasks should remain isolated from each other, " +
      "for example a frontend task and a backend task in separate worktrees. The new session's actual " +
      "location is the worktree directory (OpenCode native session API — not a simulated directory change), " +
      "so its file edits, shell commands, and VCS operations run inside that worktree. The task is delivered " +
      "through the official session prompt API. Returns the new sessionID and worktree directory.",
    input: {
      type: "object",
      properties: {
        worktree: {
          type: "string",
          description: "Worktree name (or absolute directory) of a managed worktree, as returned by worktree_list.",
        },
        task: {
          type: "string",
          description: "Full, self-contained task description for the new agent session.",
        },
        agent: {
          type: "string",
          description: "Optional OpenCode agent name to run the session with (defaults to the project default agent).",
        },
        model: {
          type: "object",
          description: "Optional model override for the new session.",
          properties: {
            providerID: { type: "string" },
            id: { type: "string" },
          },
          required: ["providerID", "id"],
          additionalProperties: false,
        },
        wait: {
          type: "boolean",
          description:
            "Wait for the spawned session to finish before returning. Only use this for a single delegated " +
            "task; leave it off (default) when spawning several parallel sessions.",
        },
      },
      required: ["worktree", "task"],
      additionalProperties: false,
    },
    output: { type: "object" },
    async execute(rawInput, tool) {
      const input = (rawInput ?? {}) as {
        worktree?: string
        task?: string
        agent?: string
        model?: { providerID?: string; id?: string }
        wait?: boolean
      }
      if (typeof input.task !== "string") {
        throw new InvalidInputError('The "task" input is required.')
      }
      if (input.model !== undefined && (typeof input.model !== "object" || typeof input.model.providerID !== "string" || typeof input.model.id !== "string")) {
        throw new InvalidInputError('The "model" input must be an object with "providerID" and "id" strings.')
      }
      await tool.progress({ status: `resolving worktree ${String(input.worktree)}` })
      const resolved = await resolveWorktree(deps, input.worktree ?? "")
      await tool.progress({ status: `starting session in ${resolved.directory}` })
      const result = await spawnWorktreeAgent(deps, {
        worktree: resolved,
        task: input.task,
        agent: input.agent,
        model: input.model as { providerID: string; id: string } | undefined,
        wait: input.wait,
      })
      return {
        output: { ...result },
        content: withJson(
          `Started session ${result.sessionID} in managed worktree "${resolved.name}" (${resolved.directory}).` +
            (result.waited ? " The session finished its task." : " It is now working on the task independently."),
          { ...result },
        ),
        metadata: { sessionID: result.sessionID, worktree: resolved.directory },
      }
    },
  })
}
