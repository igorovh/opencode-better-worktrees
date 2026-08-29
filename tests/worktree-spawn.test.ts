import { describe, expect, test } from "bun:test"
import { buildCreateTool } from "../src/tools/create.ts"
import { buildSpawnAgentTool } from "../src/tools/spawn-agent.ts"
import { output, result, makeHarness } from "./helpers/fakes.ts"

describe("worktree_spawn_agent", () => {
  test("creates a session at the worktree location and prompts it with the task", async () => {
    const h = makeHarness()
    const created = await output<{ directory: string }>(buildCreateTool(h.deps), { name: "frontend" })
    const spawn = buildSpawnAgentTool(h.deps)

    const out = await output<{ sessionID: string; directory: string; task: string; started: boolean }>(
      spawn,
      { worktree: "frontend", task: "Implement the new navigation bar.", agent: "build" },
      "ses_main",
    )

    expect(out.started).toBe(true)
    expect(out.directory).toBe(created.directory)
    expect(out.task).toBe("Implement the new navigation bar.")

    const session = await h.sessions.get(out.sessionID)
    expect(session.directory).toBe(created.directory) // real location, not a fake cwd
    expect(h.sessions.prompts).toEqual([{ sessionID: out.sessionID, text: "Implement the new navigation bar." }])
  })

  test("passes agent and model through to the native session create", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "backend" })
    const spawn = buildSpawnAgentTool(h.deps)

    const originalCreate = h.sessions.createAtLocation
    let captured: Parameters<typeof originalCreate>[0] | undefined
    ;(h.sessions as unknown as { createAtLocation: typeof originalCreate }).createAtLocation = async (input) => {
      captured = input
      return originalCreate.call(h.sessions, input)
    }

    const out = await output<{ sessionID: string }>(
      spawn,
      { worktree: "backend", task: "Do backend work.", agent: "build", model: { providerID: "anthropic", id: "claude-sonnet-4-6" } },
    )

    expect(captured).toMatchObject({
      agent: "build",
      model: { providerID: "anthropic", id: "claude-sonnet-4-6" },
      directory: h.worktrees.entries[0]!.directory,
    })
    expect(out.sessionID).toBeTruthy()
  })

  test("rejects unknown agent names before creating a session", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "backend" })
    const spawn = buildSpawnAgentTool(h.deps)

    const res = await result(spawn, { worktree: "backend", task: "Work.", agent: "ghost" })
    expect(res.output).toMatchObject({ message: expect.stringContaining("not available") })
    expect(h.sessions.prompts).toHaveLength(0)
  })

  test("waits for the delegated session only when requested", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "one" })
    const spawn = buildSpawnAgentTool(h.deps)

    await output<{ waited?: boolean }>(spawn, { worktree: "one", task: "Task A." })
    expect(h.sessions.waits).toHaveLength(0)

    const out = await output<{ waited?: boolean }>(spawn, { worktree: "one", task: "Task B.", wait: true })
    expect(out.waited).toBe(true)
    expect(h.sessions.waits).toHaveLength(1)
  })

  test("parallel sessions live in different worktrees with isolated state", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "frontend" })
    await output(buildCreateTool(h.deps), { name: "backend" })
    const spawn = buildSpawnAgentTool(h.deps)

    const [frontend, backend] = await Promise.all([
      output<{ sessionID: string; directory: string }>(spawn, { worktree: "frontend", task: "Frontend task." }),
      output<{ sessionID: string; directory: string }>(spawn, { worktree: "backend", task: "Backend task." }),
    ])

    expect(frontend.sessionID).not.toBe(backend.sessionID)
    expect(frontend.directory).not.toBe(backend.directory)

    const feSession = await h.sessions.get(frontend.sessionID)
    const beSession = await h.sessions.get(backend.sessionID)
    expect(feSession.directory).toBe(frontend.directory)
    expect(beSession.directory).toBe(backend.directory)
    expect(h.sessions.prompts).toHaveLength(2)
  })
})
