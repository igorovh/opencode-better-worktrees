import { describe, expect, test } from "bun:test"
import { WorktreeGateway, normalizeTransportError } from "../src/opencode/gateway.ts"
import type { NativeWorktreeApi } from "../src/opencode/types.ts"
import { WorktreeFailure, isWorktreeFailure } from "../src/utils/errors.ts"
import { nativeWorktreeError, PROJECT } from "./helpers/fakes.ts"

function recordingApi(overrides: Partial<NativeWorktreeApi> = {}) {
  const calls: { operation: string; input: unknown }[] = []
  const api: NativeWorktreeApi = {
    async list(input) {
      calls.push({ operation: "list", input })
      return [{ directory: "/repo" }]
    },
    async create(input) {
      calls.push({ operation: "create", input })
      return { directory: "/worktrees/task" }
    },
    async remove(input) {
      calls.push({ operation: "remove", input })
    },
    async refresh(input) {
      calls.push({ operation: "refresh", input })
    },
    ...overrides,
  }
  return { api, calls }
}

describe("gateway error normalization", () => {
  test("native WorktreeError bodies become WorktreeFailure with forceRequired", () => {
    const failure = normalizeTransportError(nativeWorktreeError("worktree is dirty", true))
    expect(isWorktreeFailure(failure)).toBe(true)
    expect(failure.message).toBe("worktree is dirty")
    expect(failure.forceRequired).toBe(true)
  })

  test("in-process Worktree.OperationError keeps its message and forceRequired", () => {
    const failure = normalizeTransportError({ _tag: "Worktree.OperationError", message: "worktree is dirty", forceRequired: true })
    expect(failure).toMatchObject({ message: "worktree is dirty", forceRequired: true, nativeName: "WorktreeError" })
  })

  test("forceRequired=null native hint maps to undefined, not true", () => {
    const failure = normalizeTransportError({ name: "WorktreeError", data: { message: "locked", forceRequired: null } })
    expect(failure.forceRequired).toBeUndefined()
  })

  test("generic errors and non-error throwables keep their message", () => {
    expect(normalizeTransportError(new Error("boom")).message).toBe("boom")
    expect(normalizeTransportError("plain string").message).toBe("plain string")
  })
})

describe("WorktreeGateway", () => {
  test("sends projectID on every native call and maps baseRef to the native starting ref", async () => {
    const { api, calls } = recordingApi()
    const gateway = new WorktreeGateway({ projectID: () => PROJECT.id, worktree: api })

    await gateway.list({ projectID: PROJECT.id })
    await gateway.create({ projectID: PROJECT.id, directory: "/worktrees", name: "task", baseRef: "origin/pr-209" })
    await gateway.remove({ projectID: PROJECT.id, directory: "/worktrees/task", force: false })
    await gateway.refresh({ projectID: PROJECT.id })

    expect(calls).toEqual([
      { operation: "list", input: { projectID: PROJECT.id } },
      { operation: "create", input: { projectID: PROJECT.id, name: "task", directory: "/worktrees", branch: "origin/pr-209" } },
      { operation: "remove", input: { projectID: PROJECT.id, directory: "/worktrees/task", force: false } },
      { operation: "refresh", input: { projectID: PROJECT.id } },
    ])
  })

  test("omitted directory and baseRef stay out of the request so OpenCode picks the location and HEAD", async () => {
    const { api, calls } = recordingApi()
    const gateway = new WorktreeGateway({ projectID: () => PROJECT.id, worktree: api })

    await gateway.create({ projectID: PROJECT.id, name: "task" })
    expect(calls[0]!.input).toEqual({ projectID: PROJECT.id, name: "task" })
  })

  test("rejects cross-project operations before calling OpenCode", async () => {
    const { api, calls } = recordingApi()
    const gateway = new WorktreeGateway({ projectID: () => PROJECT.id, worktree: api })
    const projectID = "prj_other"
    await expect(gateway.list({ projectID })).rejects.toThrow("unknown project")
    await expect(gateway.create({ projectID, name: "task" })).rejects.toThrow("unknown project")
    await expect(gateway.remove({ projectID, directory: "/worktrees/task", force: false })).rejects.toThrow("unknown project")
    await expect(gateway.refresh({ projectID })).rejects.toThrow("unknown project")
    expect(calls).toEqual([])
  })

  test("refuses to call OpenCode without a project id instead of sending a request without one", async () => {
    const { api, calls } = recordingApi()
    const gateway = new WorktreeGateway({ projectID: () => "", worktree: api })
    await expect(gateway.list({ projectID: "" })).rejects.toBeInstanceOf(WorktreeFailure)
    expect(calls).toEqual([])
  })

  test("reads the project id at call time", async () => {
    let current = ""
    const { api } = recordingApi()
    const gateway = new WorktreeGateway({ projectID: () => current, worktree: api })
    current = PROJECT.id
    expect(await gateway.list({ projectID: PROJECT.id })).toEqual([{ directory: "/repo", strategy: undefined }])
  })

  test("an unresolved project triggers one refresh and one retry", async () => {
    let attempts = 0
    const { api, calls } = recordingApi({
      async create() {
        attempts += 1
        if (attempts === 1) throw new Error('Missing key\n  at ["projectID"]')
        return { directory: "/worktrees/task" }
      },
    })
    const gateway = new WorktreeGateway({ projectID: () => PROJECT.id, worktree: api })

    expect(await gateway.create({ projectID: PROJECT.id, name: "task" })).toEqual({ directory: "/worktrees/task" })
    expect(attempts).toBe(2)
    expect(calls).toEqual([{ operation: "refresh", input: { projectID: PROJECT.id } }])
  })

  test("other failures are not retried", async () => {
    let attempts = 0
    const { api, calls } = recordingApi({
      async remove() {
        attempts += 1
        throw nativeWorktreeError("worktree is dirty", true)
      },
    })
    const gateway = new WorktreeGateway({ projectID: () => PROJECT.id, worktree: api })

    await expect(gateway.remove({ projectID: PROJECT.id, directory: "/worktrees/task", force: false })).rejects.toMatchObject({
      message: "worktree is dirty",
      forceRequired: true,
    })
    expect(attempts).toBe(1)
    expect(calls).toEqual([])
  })
})
