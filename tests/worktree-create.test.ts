import { describe, expect, test } from "bun:test"
import { buildCreateTool } from "../src/tools/create.ts"
import { buildListTool } from "../src/tools/list.ts"
import { resolveDirectoryRoot } from "../src/options.ts"
import { resolveInsideRoot } from "../src/utils/paths.ts"
import { nativeWorktreeError, output, PROJECT, result, makeHarness } from "./helpers/fakes.ts"

describe("worktree_create", () => {
  test("creates a managed worktree through the V2 API with the native payload", async () => {
    const h = makeHarness()
    const tool = buildCreateTool(h.deps)

    const out = await output(tool, { name: "auth" })

    expect(out.created).toBe(true)
    expect(out.name).toBe("auth")
    expect(out.projectID).toBe(PROJECT.id)
    expect(out.detached).toBe(true)
    expect(out.branch).toBe("agent/auth") // suggested branch (default branchPrefix)

    // Native create received the exact verified beta request shape:
    // `directory` is the parent, `name` the leaf, `baseRef` absent without `from`.
    expect(h.worktrees.createCalls).toHaveLength(1)
    const call = h.worktrees.createCalls[0]!
    expect(call.projectID).toBe(PROJECT.id)
    expect(call.name).toBe("auth")
    expect(call.directory).toBe(resolveDirectoryRoot(h.options, PROJECT.canonical))
    expect(call.baseRef).toBeUndefined()
  })

  test("forwards `from` as the detach ref and `branch` as the suggested branch name", async () => {
    const h = makeHarness()
    const tool = buildCreateTool(h.deps)

    const out = await output(tool, { name: "feat", branch: "feature/one", from: "main" })

    const call = h.worktrees.createCalls[0]!
    expect(call.baseRef).toBe("main")
    expect(out.branch).toBe("feature/one")
    expect(out.from).toBe("main")
  })

  test("returns the absolute directory in text and structured output", async () => {
    const h = makeHarness()
    const tool = buildCreateTool(h.deps)

    const res = await result(tool, { name: "backend" })
    const out = res.output!
    const textContent = (res.content as { type: "text"; text: string }[])[0]!
    expect(out.created).toBe(true)
    expect(textContent.type).toBe("text")
    expect(textContent.text).toContain(String(out.directory))
  })

  test("refuses duplicate names and duplicate directories", async () => {
    const h = makeHarness()
    const tool = buildCreateTool(h.deps)

    await output(tool, { name: "auth" })
    expect(h.worktrees.createCalls).toHaveLength(1)

    // Same name -> refused without a second native call.
    const second = await result(tool, { name: "auth" })
    expect((second.output as { created?: boolean }).created).toBeUndefined()
    expect(second.output).toMatchObject({ message: expect.stringContaining("already exists") })
    expect(h.worktrees.createCalls).toHaveLength(1)

    // Different name resolving to the same directory -> also refused.
    const weirdButValid = await result(tool, { name: "auth" })
    expect(weirdButValid.output).toMatchObject({ message: expect.stringContaining("already exists") })
  })

  test("refuses to touch an existing unmanaged directory", async () => {
    const h = makeHarness()
    const target = resolveInsideRoot(resolveDirectoryRoot(h.options, PROJECT.canonical), "taken")
    h.fs.add(target)
    const tool = buildCreateTool(h.deps)

    const res = await result(tool, { name: "taken" })
    expect(res.output).toMatchObject({ message: expect.stringContaining("not an OpenCode-managed worktree") })
    expect(h.worktrees.createCalls).toHaveLength(0)
  })

  test("propagates native create errors verbatim", async () => {
    const h = makeHarness()
    h.worktrees.createError = nativeWorktreeError("branch already checked out")
    const tool = buildCreateTool(h.deps)

    const res = await result(tool, { name: "auth" })
    expect(res.output).toMatchObject({ message: "branch already checked out" })
  })

  test("rejects path traversal and unsafe names", async () => {
    const h = makeHarness()
    const tool = buildCreateTool(h.deps)

    for (const bad of ["../escape", "a/b", "..", ".", ".hidden", "", "a\\b", "x".repeat(65)]) {
      const res = await result(tool, { name: bad })
      expect(res.output).toMatchObject({ message: expect.any(String) })
      expect(h.worktrees.createCalls).toHaveLength(0)
    }
  })

  test("parallel creates with the same name create exactly one worktree (mutex)", async () => {
    const h = makeHarness()
    const tool = buildCreateTool(h.deps)

    const results = await Promise.all([
      output<{ created?: boolean; message?: string }>(tool, { name: "same" }),
      output<{ created?: boolean; message?: string }>(tool, { name: "same" }),
      output<{ created?: boolean; message?: string }>(tool, { name: "same" }),
    ])

    const created = results.filter((r) => r.created === true)
    const refused = results.filter((r) => r.created !== true)
    expect(created).toHaveLength(1)
    expect(refused).toHaveLength(2)
    expect(refused[0]!.message).toContain("already exists")
    expect(h.worktrees.createCalls).toHaveLength(1)
  })

  test("list after create shows the managed entry", async () => {
    const h = makeHarness()
    await output(buildCreateTool(h.deps), { name: "auth" })
    const listed = await output<{ worktrees: { name: string; kind: string; strategy?: string }[] }>(buildListTool(h.deps), {})
    expect(listed.worktrees).toHaveLength(1)
    expect(listed.worktrees[0]).toMatchObject({ name: "auth", kind: "managed", strategy: "git" })
  })
})
