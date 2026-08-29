/**
 * `worktree_use` — move the CURRENT OpenCode session into a managed worktree.
 *
 * Uses the native `v2.session.move` API so the session's actual location
 * becomes the worktree directory; subsequent file edits, shell commands, and
 * agent work happen inside the worktree through OpenCode's normal tools.
 *
 * Semantics: `session.move` changes the session's location pointer. It does
 * NOT transfer or overwrite files. Any uncommitted changes in the previous
 * directory stay there, so the result reports them explicitly instead of
 * silently losing track of them.
 */

import type { ToolDeps, ToolExecutionContext, WorktreeTool } from "./shared.ts"
import { defineTool, resolveWorktree, summarizeChanges, withJson } from "./shared.ts"
import { samePath } from "../utils/paths.ts"

export function buildUseTool(deps: ToolDeps): WorktreeTool {
  return defineTool({
    name: "worktree_use",
    description:
      "Move the current OpenCode session into an existing managed worktree so subsequent file edits, shell " +
      "commands, and agent work happen inside that isolated worktree. Use this right after creating a " +
      "worktree for your own work, or to return to a worktree you were previously working in. The session's " +
      "location is moved with OpenCode's native session move API — the plugin does not fake an active " +
      "worktree. Uncommitted changes in the current directory stay where they are and are reported back to " +
      "you; they are never moved or discarded.",
    input: {
      type: "object",
      properties: {
        worktree: {
          type: "string",
          description: "Worktree name (or absolute directory) of a managed worktree, as returned by worktree_list.",
        },
      },
      required: ["worktree"],
      additionalProperties: false,
    },
    output: { type: "object" },
    async execute(rawInput, tool: ToolExecutionContext) {
      const input = (rawInput ?? {}) as { worktree?: string }
      const resolved = await resolveWorktree(deps, input.worktree ?? "")

      // Ownership: refuse sessions that belong to a different project.
      const session = await deps.sessions.get(tool.sessionID)
      if (session.projectID !== deps.project.id) {
        return {
          output: { moved: false, reason: "project-mismatch", sessionProjectID: session.projectID, projectID: deps.project.id },
          content: withJson(
            `Refusing to move: this session belongs to a different project (${session.projectID}) than the ` +
              `one this worktree plugin manages (${deps.project.id}).`,
            { moved: false, reason: "project-mismatch" },
          ),
        }
      }

      if (samePath(session.directory, resolved.directory)) {
        return {
          output: { moved: false, alreadyThere: true, directory: resolved.directory },
          content: withJson(`This session is already located in "${resolved.directory}".`, {
            moved: false,
            alreadyThere: true,
            directory: resolved.directory,
          }),
        }
      }

      // Surface uncommitted changes left behind in the current directory.
      let leftBehind: { directory: string; changes: number; additions: number; deletions: number } | undefined
      try {
        const current = await deps.vcs.status(session.directory)
        if (current.length > 0) {
          const summary = summarizeChanges(current)
          leftBehind = { directory: session.directory, ...summary }
        }
      } catch {
        // Status is advisory only; never block the move because of it.
      }

      await deps.sessions.move(tool.sessionID, resolved.directory)
      const updated = await deps.sessions.get(tool.sessionID)

      const output = {
        moved: true,
        from: session.directory,
        directory: updated.directory,
        leftBehind,
      }
      const human =
        `Session moved to managed worktree "${resolved.name}" at ${updated.directory}.` +
        (leftBehind
          ? ` Note: ${leftBehind.changes} uncommitted change(s) (+${leftBehind.additions}/-${leftBehind.deletions}) remain in ${leftBehind.directory}; they were not moved.`
          : "")
      return { output, content: withJson(human, output), metadata: { worktree: updated.directory } }
    },
  })
}
