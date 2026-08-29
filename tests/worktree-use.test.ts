import { describe, expect, test } from "bun:test"
import { buildCreateTool } from "../src/tools/create.ts"
import { buildUseTool } from "../src/tools/use.ts"
import { output, result, makeHarness } from "./helpers/fakes.ts"

describe("worktree_use", () => {
  test("moves the current session to the worktree via the native session move API", async () => {
    const h = makeHarness()
    const created = await output<{ directory: string }>(buildCreateTool(h.deps), { name: "auth" })
    const use = buildUseTool(h.deps)

    const out = await output<{ moved: boolean; from: string; directory: string }>(use, { worktree: "auth" }, "ses_main")

    expect(out.moved).toBe(true)
    expect(out.from).toBe("/repo")
    expect(out.directory).toBe(created.directory)
    expect(h.sessions.moves).toEqual([{ sessionID: "ses_main", directory: created.directory }])

    // Session location is now the worktree (source of truth re-read from the API).
    const session = await h.sessions.get("ses_main")
    expect(session.directory).toBe(created.directory)
  })

  test("is a no-op when the session already sits in the worktree", async () => {
    const h = makeHarness()
    const created = await output<{ directory: string }>(buildCreateTool(h.deps), { name: "auth" })
    const use = buildUseTool(h.deps)

    await output(use, { worktree: "auth" }, "ses_main")
    const moves = h.sessions.moves.length
    const out = await output<{ moved: boolean; alreadyThere: boolean }>(use, { worktree: "auth" }, "ses_main")

    expect(out.moved).toBe(false)
    expect(out.alreadyThere).toBe(true)
    expect(h.sessions.moves).toHaveLength(moves)
  })

  test("reports uncommitted changes left behind in the previous directory", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "auth" })
    h.vcs.setChanges("/repo", [{ file: "dirty.ts", additions: 3, deletions: 7, status: "modified" }])
    const use = buildUseTool(h.deps)

    const res = await result(use, { worktree: "auth" }, "ses_main")
    const out = res.output as { moved: boolean; leftBehind?: { directory: string; changes: number; additions: number; deletions: number } }

    expect(out.moved).toBe(true)
    expect(out.leftBehind).toMatchObject({ directory: "/repo", changes: 1, additions: 3, deletions: 7 })

    const text = (res.content as { type: "text"; text: string }[])[0]!.text
    expect(text).toContain("remain in /repo")
    expect(text).toContain("were not moved")
  })

  test("refuses to move a session that belongs to another project", async () => {
    const h = makeHarness({ initialSession: { id: "ses_foreign", projectID: "prj_other", directory: "/other" } })
    await output(buildCreateTool(h.deps), { name: "auth" })
    const use = buildUseTool(h.deps)

    const out = await output<{ moved: boolean; reason: string }>(use, { worktree: "auth" }, "ses_foreign")

    expect(out.moved).toBe(false)
    expect(out.reason).toBe("project-mismatch")
    expect(h.sessions.moves).toHaveLength(0)
  })
})
