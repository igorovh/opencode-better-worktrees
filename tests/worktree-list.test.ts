import { describe, expect, test } from "bun:test"
import { buildListTool } from "../src/tools/list.ts"
import { output, makeHarness, PROJECT } from "./helpers/fakes.ts"

describe("worktree_list", () => {
  test("lists managed worktrees from the native API with kind markers", async () => {
    const h = makeHarness()
    h.worktrees.entries = [
      { directory: "/repo", strategy: undefined }, // root entry: no strategy
      { directory: "/repo/../.opencode-worktrees/auth", strategy: "git_worktree" },
      { directory: "/repo/../.opencode-worktrees/frontend", strategy: "git_worktree" },
    ]

    const out = await output<{ projectID: string; worktrees: { directory: string; name: string; kind: string; strategy?: string }[] }>(
      buildListTool(h.deps),
      {},
    )

    expect(out.projectID).toBe(PROJECT.id)
    expect(out.worktrees).toHaveLength(3)
    expect(out.worktrees[0]).toMatchObject({ kind: "root", name: "repo" })
    expect(out.worktrees.slice(1).map((w) => w.kind)).toEqual(["managed", "managed"])
    expect(out.worktrees.map((w) => w.name)).toEqual(["repo", "auth", "frontend"])
  })

  test("includeStatus enriches entries with branch and change info", async () => {
    const h = makeHarness()
    h.worktrees.entries = [{ directory: "/wt/auth", strategy: "git_worktree" }]
    h.vcs.setBranch("/wt/auth", { current: "agent/auth", default: "main" })
    h.vcs.setChanges("/wt/auth", [
      { file: "src/a.ts", additions: 10, deletions: 2, status: "modified" },
      { file: "src/b.ts", additions: 0, deletions: 40, status: "deleted" },
    ])

    const out = await output<{ worktrees: Record<string, unknown>[] }>(buildListTool(h.deps), { includeStatus: true })
    const entry = out.worktrees[0]!

    expect(entry).toMatchObject({
      name: "auth",
      branch: "agent/auth",
      changes: 2,
      additions: 10,
      deletions: 42,
      clean: false,
    })
  })

  test("includeStatus tolerates entries without VCS information", async () => {
    const h = makeHarness()
    h.worktrees.entries = [{ directory: "/wt/plain", strategy: "git_worktree" }]

    const out = await output<{ worktrees: Record<string, unknown>[] }>(buildListTool(h.deps), { includeStatus: true })
    expect(out.worktrees[0]).toMatchObject({ name: "plain" })
    expect(out.worktrees[0]).not.toHaveProperty("branch", expect.anything())
  })
})
