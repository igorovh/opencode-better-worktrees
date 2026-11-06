import type { ToolDeps, WorktreeTool } from "./shared.ts"
import { defineTool, resolveWorktree, withJson } from "./shared.ts"
import { toWorktreeFailure } from "../utils/errors.ts"
import { pathKey, samePath } from "../utils/paths.ts"

export function buildRemoveTool(deps: ToolDeps): WorktreeTool {
  return defineTool({
    name: "worktree_remove",
    description:
      "Safely remove an OpenCode-managed worktree that is no longer needed, for example after its task was " +
      "merged or abandoned. Removal goes through OpenCode's native Worktree API; the plugin refuses anything " +
      "that is not a managed worktree and never removes the project's main directory. If the worktree still " +
      "contains changes, OpenCode refuses the removal and reports that force is required — never retry with " +
      "force unless the user explicitly requested destructive cleanup (e.g. \"delete it even though it is dirty\").",
    input: {
      type: "object",
      properties: {
        worktree: {
          type: "string",
          description: "Worktree name (or absolute directory) of a managed worktree, as returned by worktree_list.",
        },
        force: {
          type: "boolean",
          description:
            "Force removal even when the worktree contains uncommitted changes. Defaults to false. Only set " +
            "this when the user explicitly asked for destructive cleanup.",
        },
      },
      required: ["worktree"],
      additionalProperties: false,
    },
    output: { type: "object" },
    async execute(rawInput) {
      const input = (rawInput ?? {}) as { worktree?: string; force?: boolean }
      const force = input.force === true // never infer; absence means false
      const resolved = await resolveWorktree(deps, input.worktree ?? "")

      // Never remove the project's main working copy.
      const isRoot =
        !resolved.strategy ||
        samePath(resolved.directory, deps.project.directory) ||
        samePath(resolved.directory, deps.project.canonical)
      if (isRoot) {
        const message =
          `"${resolved.directory}" is the project's main working directory, not a removable managed worktree. ` + "Refusing to remove it."
        return {
          output: { removed: false, reason: "root-directory", directory: resolved.directory },
          content: withJson(message, { removed: false, reason: "root-directory", directory: resolved.directory }),
        }
      }

      // Serialize against concurrent creates of the same directory.
      return deps.locks.run(pathKey(resolved.directory), async () => {
        try {
          await deps.worktrees.remove({ projectID: deps.project.id, directory: resolved.directory, force })
          const output = { removed: true, directory: resolved.directory, name: resolved.name, forced: force }
          return {
            output,
            content: withJson(`Removed managed worktree "${resolved.name}" at ${resolved.directory}${force ? " (forced)" : ""}.`, output),
            metadata: { worktree: resolved.directory },
          }
        } catch (error) {
          const failure = toWorktreeFailure(error)
          const output = {
            removed: false,
            directory: resolved.directory,
            name: resolved.name,
            forceRequired: failure.forceRequired === true,
            message: failure.message,
          }
          const human =
            `Could not remove "${resolved.name}": ${failure.message}` +
            (failure.forceRequired === true
              ? " OpenCode reports force is required because the worktree is not clean. Do NOT retry with force " +
                "unless the user explicitly requested destructive cleanup."
              : "")
          return { output, content: withJson(human, output), metadata: { worktree: resolved.directory } }
        }
      })
    },
  })
}
