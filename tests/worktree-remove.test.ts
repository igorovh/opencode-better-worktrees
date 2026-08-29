import { describe, expect, test } from "bun:test"
import { buildCreateTool } from "../src/tools/create.ts"
import { buildRemoveTool } from "../src/tools/remove.ts"
import { nativeWorktreeError, output, result, makeHarness, PROJECT } from "./helpers/fakes.ts"

describe("worktree_remove", () => {
  test("removes a clean worktree with force=false by default", async () => {
    const h = makeHarness()
    const created = await output<{ directory: string }>(buildCreateTool(h.deps), { name: "auth" })
    const remove = buildRemoveTool(h.deps)

    const out = await output<{ removed: boolean; forced: boolean; directory: string }>(remove, { worktree: "auth" })

    expect(out.removed).toBe(true)
    expect(out.forced).toBe(false)
    expect(out.directory).toBe(created.directory)
    expect(h.worktrees.removeCalls).toEqual([
      { projectID: PROJECT.id, directory: created.directory, force: false },
    ])
    // The native list no longer contains it.
    expect(h.worktrees.entries).toHaveLength(0)
  })

  test("never force-removes by default and never escalates automatically", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "dirty" })
    h.worktrees.removeError = nativeWorktreeError("worktree contains modified or untracked files", true)
    const remove = buildRemoveTool(h.deps)

    const res = await result(remove, { worktree: "dirty" }) // no force input at all
    const out = res.output as { removed: boolean; forceRequired: boolean; message: string }

    expect(h.worktrees.removeCalls[0]!.force).toBe(false)
    expect(out.removed).toBe(false)
    expect(out.forceRequired).toBe(true)
    expect(out.message).toBe("worktree contains modified or untracked files")

    const text = (res.content as { type: "text"; text: string }[])[0]!.text
    expect(text).toContain("Do NOT retry with force")
    // Only one remove attempt: no automatic forced retry.
    expect(h.worktrees.removeCalls).toHaveLength(1)
  })

  test("removes with force only when explicitly requested", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "dirty" })
    h.worktrees.removeError = nativeWorktreeError("worktree contains modified or untracked files", true)
    const remove = buildRemoveTool(h.deps)

    const refused = await result(remove, { worktree: "dirty" })
    expect((refused.output as { removed: boolean }).removed).toBe(false)

    h.worktrees.removeError = undefined
    const forced = await output<{ removed: boolean; forced: boolean }>(remove, { worktree: "dirty", force: true })
    expect(forced).toMatchObject({ removed: true, forced: true })
    expect(h.worktrees.removeCalls[1]!.force).toBe(true)
  })

  test("refuses to remove the project root even if it appears in the list", async () => {
    const h = makeHarness()
    h.worktrees.entries = [{ directory: PROJECT.directory, strategy: undefined }, { directory: PROJECT.canonical, strategy: "git_worktree" }]
    const remove = buildRemoveTool(h.deps)

    for (const reference of [PROJECT.canonical, PROJECT.directory]) {
      const res = await result(remove, { worktree: reference })
      expect(res.output).toMatchObject({ removed: false, reason: "root-directory" })
      expect(h.worktrees.removeCalls).toHaveLength(0)
    }
  })

  test("refuses worktrees outside the native list (arbitrary paths)", async () => {
    const h = makeHarness()
    const remove = buildRemoveTool(h.deps)

    for (const evil of ["C:\\Windows", "/etc", "../../elsewhere", "./sibling"]) {
      const res = await result(remove, { worktree: evil })
      expect(res.output).toMatchObject({ message: expect.stringContaining("not a worktree managed by OpenCode") })
    }
    expect(h.worktrees.removeCalls).toHaveLength(0)
  })

  test("propagates non-force native failures without inventing force semantics", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "locked" })
    h.worktrees.removeError = nativeWorktreeError("worktree is locked by another process")
    const remove = buildRemoveTool(h.deps)

    const res = await result(remove, { worktree: "locked" })
    expect(res.output).toMatchObject({
      removed: false,
      forceRequired: false,
      message: "worktree is locked by another process",
    })
  })
})
