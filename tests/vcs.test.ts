import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { contextVcs } from "../src/opencode/vcs.ts"
import { WorktreeFailure } from "../src/utils/errors.ts"

type VcsDomain = Parameters<typeof contextVcs>[0]

function fakeVcs(answeredDirectory: string): VcsDomain {
  const change = { file: "a.ts", additions: 1, deletions: 0, status: "modified" }
  return {
    get: async () => ({ location: { directory: answeredDirectory }, data: { branch: { current: "main", default: "main" } } }),
    status: async () => ({ location: { directory: answeredDirectory }, data: [change] }),
    diff: async () => ({ location: { directory: answeredDirectory }, data: [{ ...change, patch: "--- a/a.ts" }] }),
  } as unknown as VcsDomain
}

describe("location-scoped VCS", () => {
  const worktree = resolve("/worktrees/auth")

  test("returns data when OpenCode answers for the requested directory", async () => {
    const vcs = contextVcs(fakeVcs(worktree))
    expect(await vcs.info(worktree)).toEqual({ current: "main", default: "main" })
    expect(await vcs.status(worktree)).toHaveLength(1)
    expect(await vcs.diff(worktree)).toHaveLength(1)
  })

  test("refuses data that OpenCode returned for a different checkout", async () => {
    const vcs = contextVcs(fakeVcs(resolve("/repo")))
    await expect(vcs.info(worktree)).rejects.toBeInstanceOf(WorktreeFailure)
    await expect(vcs.status(worktree)).rejects.toThrow("instead of")
    await expect(vcs.diff(worktree)).rejects.toThrow("instead of")
  })
})
