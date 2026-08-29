import { describe, expect, test } from "bun:test"
import { buildDelegateTool } from "../src/tools/delegate.ts"
import { buildRemoveTool } from "../src/tools/remove.ts"
import { output, result, makeHarness, PROJECT, nativeWorktreeError } from "./helpers/fakes.ts"

describe("worktree_delegate", () => {
  test("creates the worktree and delegates the prompt in one operation using shared primitives", async () => {
    const h = makeHarness()
    const delegate = buildDelegateTool(h.deps)

    const res = await result(delegate, { name: "payments", task: "Implement the refunds API end to end." })
    const out = res.output as {
      name: string
      directory: string
      branch?: string
      sessionID: string
      task: string
      started: boolean
    }

    expect(out.started).toBe(true)
    expect(out.name).toBe("payments")
    expect(out.branch).toBe("agent/payments")
    expect(out.sessionID).toBeTruthy()

    // Exactly one native create with the verified beta payload.
    expect(h.worktrees.createCalls).toHaveLength(1)
    expect(h.worktrees.createCalls[0]).toMatchObject({
      projectID: PROJECT.id,
      strategy: "git",
      name: "payments",
    })

    // The spawned session's real location is the new worktree.
    const session = await h.sessions.get(out.sessionID)
    expect(session.directory).toBe(out.directory)
    expect(h.sessions.prompts).toEqual([{ sessionID: out.sessionID, text: "Implement the refunds API end to end." }])

    const text = (res.content as { type: "text"; text: string }[])[0]!.text
    expect(text).toContain(out.sessionID)
    expect(text).toContain(out.directory)
  })

  test("supports waiting for the delegated session", async () => {
    const h = makeHarness()
    const delegate = buildDelegateTool(h.deps)

    const out = await output<{ waited?: boolean }>(delegate, { name: "slow", task: "Long task.", wait: true })
    expect(out.waited).toBe(true)
    expect(h.sessions.waits).toHaveLength(1)
  })

  test("a failed delegation leaves no half-created session prompts", async () => {
    const h = makeHarness()
    // Native-shaped failure, like the generated client throws for declared 400s.
    h.worktrees.createError = nativeWorktreeError("git backend exploded")
    const delegate = buildDelegateTool(h.deps)

    const res = await result(delegate, { name: "boom", task: "Task." })
    expect(res.output).toMatchObject({ ok: false, message: "git backend exploded" })
    expect(h.sessions.prompts).toHaveLength(0)
  })

  test("delegated worktrees can be removed again once safe", async () => {
    const h = makeHarness()
    const delegate = buildDelegateTool(h.deps)
    const out = await output<{ directory: string }>(delegate, { name: "temp", task: "Task." })

    const removed = await output<{ removed: boolean }>(buildRemoveTool(h.deps), { worktree: "temp" })
    expect(removed.removed).toBe(true)
    expect(h.worktrees.entries).toHaveLength(0)
    void out
  })
})
