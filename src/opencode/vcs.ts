/**
 * Location-scoped VCS operations backed by the plugin context's VCS domain.
 *
 * OpenCode's VCS API accepts a `location.directory`, which lets us inspect any
 * managed worktree without parsing `git status`/`git diff` output ourselves.
 */

import type { Plugin } from "@opencode/plugin"
import { WorktreeFailure } from "../utils/errors.ts"
import type { FileChange, VcsLike } from "./types.ts"

type PluginContext = Parameters<typeof Plugin.define>[0]["setup"] extends (ctx: infer C) => unknown ? C : never
type VcsDomain = PluginContext["vcs"]

/** True when the error looks like "no repository / no VCS provider here". */
function isUnavailable(error: unknown): boolean {
  return error instanceof Error && /not a (git|mercurial) repository|no repository|unsupported/i.test(error.message)
}

export function contextVcs(vcs: VcsDomain): VcsLike {
  return {
    async info(directory) {
      try {
        const output = await vcs.get({ location: { directory } })
        return output.data.branch
      } catch (error) {
        if (isUnavailable(error)) return undefined
        throw new WorktreeFailure({ message: `VCS lookup failed for "${directory}": ${String(error)}` })
      }
    },

    async status(directory): Promise<readonly FileChange[]> {
      try {
        const output = await vcs.status({ location: { directory } })
        return output.data.map((entry) => ({
          file: entry.file,
          additions: entry.additions,
          deletions: entry.deletions,
          status: entry.status,
        }))
      } catch (error) {
        if (isUnavailable(error)) return []
        throw new WorktreeFailure({ message: `VCS status failed for "${directory}": ${String(error)}` })
      }
    },

    async diff(directory, context) {
      try {
        const output = await vcs.diff({ location: { directory }, mode: "working", context: context ?? 3 })
        return output.data.map((entry) => ({
          file: entry.file,
          additions: entry.additions,
          deletions: entry.deletions,
          status: entry.status,
          patch: entry.patch,
        }))
      } catch (error) {
        if (isUnavailable(error)) return []
        throw new WorktreeFailure({ message: `VCS diff failed for "${directory}": ${String(error)}` })
      }
    },
  }
}
