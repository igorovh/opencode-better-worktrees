/**
 * `worktree_status` — inspect one managed worktree using OpenCode's
 * location-scoped VCS APIs (branch info, working-copy status, optional diff).
 */

import type { ToolDeps, WorktreeTool } from "./shared.ts"
import { defineTool, resolveWorktree, summarizeChanges, withJson } from "./shared.ts"

export function buildStatusTool(deps: ToolDeps): WorktreeTool {
  return defineTool({
    name: "worktree_status",
    description:
      "Inspect an OpenCode-managed worktree: its directory, current branch, default branch, changed files, " +
      "additions/deletions, and whether the working copy is clean or dirty. Use this before switching a " +
      "session into a worktree, before removing one, or when the user asks what changed inside a worktree. " +
      "The worktree must be managed by OpenCode for the current project. Data comes from OpenCode's " +
      "location-scoped VCS API; no git commands are run by this plugin.",
    input: {
      type: "object",
      properties: {
        worktree: {
          type: "string",
          description: "Worktree name (or absolute directory) of a managed worktree, as returned by worktree_list.",
        },
        includeDiff: {
          type: "boolean",
          description: "Also include per-file working-copy diffs. Off by default to keep output small.",
        },
      },
      required: ["worktree"],
      additionalProperties: false,
    },
    output: { type: "object" },
    async execute(rawInput) {
      const input = (rawInput ?? {}) as { worktree?: string; includeDiff?: boolean }
      const resolved = await resolveWorktree(deps, input.worktree ?? "")

      const branch = await deps.vcs.info(resolved.directory)
      const changes = await deps.vcs.status(resolved.directory)
      const summary = summarizeChanges(changes)

      const output: Record<string, unknown> = {
        directory: resolved.directory,
        name: resolved.name,
        strategy: resolved.strategy,
        branch: branch?.current,
        defaultBranch: branch?.default,
        ...summary,
        clean: changes.length === 0,
        files: changes,
      }

      let human =
        `Worktree "${resolved.name}" on branch ${branch?.current ?? "(unknown)"}` +
        ` — ${summary.changes} changed file(s), +${summary.additions}/-${summary.deletions}` +
        ` (${changes.length === 0 ? "clean" : "dirty"}).`

      if (input.includeDiff) {
        const diffs = await deps.vcs.diff(resolved.directory)
        output.diffs = diffs
        human += " Diffs included in the JSON output."
      }

      return { output, content: withJson(human, output), metadata: { worktree: resolved.directory } }
    },
  })
}
