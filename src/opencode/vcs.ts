// Location-scoped VCS reads, so no `git status`/`git diff` output is parsed here.

import type { Plugin } from "@opencode/plugin"
import { WorktreeFailure } from "../utils/errors.ts"
import { samePath } from "../utils/paths.ts"
import type { FileChange, VcsLike } from "./types.ts"

type PluginContext = Parameters<typeof Plugin.define>[0]["setup"] extends (ctx: infer C) => unknown ? C : never
type VcsDomain = PluginContext["vcs"]

/** True when the error looks like "no repository / no VCS provider here". */
function isUnavailable(error: unknown): boolean {
  return error instanceof Error && /not a (git|mercurial) repository|no repository|unsupported/i.test(error.message)
}

async function read<T extends { location?: { directory: string } }>(
  directory: string,
  what: string,
  call: () => Promise<T>,
): Promise<T | undefined> {
  let output: T
  try {
    output = await call()
  } catch (error) {
    if (isUnavailable(error)) return undefined
    throw new WorktreeFailure({ message: `VCS ${what} failed for "${directory}": ${String(error)}` })
  }
  // Some OpenCode builds answer for the plugin's own location instead; never report another checkout's data.
  if (output.location && !samePath(output.location.directory, directory)) {
    throw new WorktreeFailure({
      message:
        `OpenCode returned VCS ${what} for "${output.location.directory}" instead of "${directory}", ` +
        "so the worktree's status is not available from this OpenCode version.",
    })
  }
  return output
}

export function contextVcs(vcs: VcsDomain): VcsLike {
  return {
    async info(directory) {
      const output = await read(directory, "info", () => vcs.get({ location: { directory } }))
      return output?.data.branch
    },

    async status(directory): Promise<readonly FileChange[]> {
      const output = await read(directory, "status", () => vcs.status({ location: { directory } }))
      return (output?.data ?? []).map((entry) => ({
        file: entry.file,
        additions: entry.additions,
        deletions: entry.deletions,
        status: entry.status,
      }))
    },

    async diff(directory, context) {
      const output = await read(directory, "diff", () => vcs.diff({ location: { directory }, mode: "working", context: context ?? 3 }))
      return (output?.data ?? []).map((entry) => ({
        file: entry.file,
        additions: entry.additions,
        deletions: entry.deletions,
        status: entry.status,
        patch: entry.patch,
      }))
    },
  }
}
