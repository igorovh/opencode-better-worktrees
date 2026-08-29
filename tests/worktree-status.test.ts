import { describe, expect, test } from "bun:test"
import { buildStatusTool } from "../src/tools/status.ts"
import { buildCreateTool } from "../src/tools/create.ts"
import { output, result, makeHarness } from "./helpers/fakes.ts"

describe("worktree resolution", () => {
  test("resolves by name, by basename, and by absolute directory", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "auth" })
    const created = await output<{ directory: string }>(buildCreateTool(h.deps), { name: "backend" })
    const status = buildStatusTool(h.deps)

    // By name and by absolute directory — both must land on the same worktree.
    for (const reference of ["backend", created.directory]) {
      const out = await output<{ name: string; directory: string }>(status, { worktree: reference })
      expect(out.directory).toBe(created.directory)
      expect(out.name).toBe("backend")
    }

    // The other worktree is independently resolvable.
    const auth = await output<{ name: string; directory: string }>(status, { worktree: "auth" })
    expect(auth.name).toBe("auth")
    expect(auth.directory).not.toBe(created.directory)
  })

  test("rejects unknown references and lists available names", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "auth" })
    const status = buildStatusTool(h.deps)

    const res = await result(status, { worktree: "nope" })
    // Serialize once: bun's asymmetric matchers (stringContaining) mutate the
    // received object, so capture the JSON before asserting on it.
    const serialized = JSON.stringify(res.output)
    expect(serialized).toContain("not a worktree managed by OpenCode")
    expect(serialized).toContain("auth")
  })

  test("rejects path traversal references (never leaves the managed set)", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "auth" })
    const status = buildStatusTool(h.deps)

    for (const evil of ["../../..", "/etc", "\\\\server\\share", "/repo/.opencode-worktrees/../../../elsewhere"]) {
      const res = await result(status, { worktree: evil })
      expect(res.output).toMatchObject({ message: expect.stringContaining("not a worktree managed by OpenCode") })
    }
  })
})

describe("worktree_status", () => {
  test("aggregates VCS information for a worktree", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "auth" })
    const created = await output<{ directory: string }>(buildCreateTool(h.deps), { name: "backend" })
    h.vcs.setBranch(created.directory, { current: "agent/backend", default: "main" })
    h.vcs.setChanges(created.directory, [
      { file: "src/x.ts", additions: 5, deletions: 1, status: "modified" },
      { file: "src/new.ts", additions: 100, deletions: 0, status: "added" },
    ])

    const out = await output(buildStatusTool(h.deps), { worktree: "backend" })

    expect(out).toMatchObject({
      directory: created.directory,
      name: "backend",
      strategy: "git",
      branch: "agent/backend",
      defaultBranch: "main",
      changes: 2,
      additions: 105,
      deletions: 1,
      clean: false,
    })
    expect((out.files as unknown[]).length).toBe(2)
    expect(out.files).toHaveLength(2)
  })

  test("reports clean state for a fresh worktree", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "fresh" })

    const out = await output<{ clean: boolean; changes: number }>(buildStatusTool(h.deps), { worktree: "fresh" })
    expect(out.clean).toBe(true)
    expect(out.changes).toBe(0)
  })
})
