import { describe, expect, test } from "bun:test"
import { buildRefreshTool } from "../src/tools/refresh.ts"
import { output, makeHarness, PROJECT } from "./helpers/fakes.ts"

describe("worktree_refresh", () => {
  test("reconciles worktree state through the native refresh API", async () => {
    const h = makeHarness()
    const tool = buildRefreshTool(h.deps)

    const out = await output<{ refreshed: boolean; projectID: string }>(tool, {})

    expect(out).toEqual({ refreshed: true, projectID: PROJECT.id })
    expect(h.worktrees.refreshCalls).toEqual([PROJECT.id])
  })
})
