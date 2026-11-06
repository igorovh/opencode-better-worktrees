import { describe, expect, test } from "bun:test"
import { buildListTool } from "../src/tools/list.ts"
import { buildCreateTool } from "../src/tools/create.ts"
import { buildUseTool } from "../src/tools/use.ts"
import { buildRemoveTool } from "../src/tools/remove.ts"
import { output, result, makeHarness, PROJECT } from "./helpers/fakes.ts"

/**
 * Cross-project protection: every tool resolves worktrees against THIS
 * project's native worktree list, and sessions from other projects are
 * refused. One project's worktree can never be used or removed by a session
 * of another project.
 */
describe("worktree ownership across projects", () => {
  test("the transport rejects lists of a different project", async () => {
    const h = makeHarness()
    await expect(h.worktrees.list({ projectID: "prj_other" })).rejects.toThrow("unknown project")
  })

  test("a foreign session cannot move into this project's worktree", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "auth" })
    h.sessions.add({ id: "ses_foreign_project", projectID: "prj_other", directory: "/other-repo" })
    const use = buildUseTool(h.deps)

    const out = await output<{ moved: boolean; reason: string }>(use, { worktree: "auth" }, "ses_foreign_project")
    expect(out.moved).toBe(false)
  })

  test("worktrees of another project are invisible to this project's tools", async () => {
    const h = makeHarness()
    // Simulate another project's worktree appearing in a raw directory sense.
    const foreignDir = "/other-repo/.opencode-worktrees/leaked"

    const listed = await output<{ worktrees: { directory: string }[] }>(buildListTool(h.deps), {})
    expect(listed.worktrees.map((w) => w.directory)).not.toContain(foreignDir)

    const use = await result(buildUseTool(h.deps), { worktree: foreignDir })
    expect(use.output).toMatchObject({ message: expect.stringContaining("not a worktree managed by OpenCode") })

    const removed = await result(buildRemoveTool(h.deps), { worktree: foreignDir })
    expect(removed.output).toMatchObject({ message: expect.stringContaining("not a worktree managed by OpenCode") })
  })

  test("project identity comes from the plugin location, not from git remotes", async () => {
    const h = makeHarness()
    const created = await output<{ projectID: string }>(buildCreateTool(h.deps), { name: "auth" })
    expect(created.projectID).toBe(PROJECT.id)
  })
})
