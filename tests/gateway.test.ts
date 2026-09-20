import { describe, expect, test } from "bun:test"
import type { WorktreeApi } from "@opencode-ai/client/promise/api"
import { WorktreeGateway, normalizeTransportError } from "../src/opencode/gateway.ts"
import { WorktreeFailure, isWorktreeFailure } from "../src/utils/errors.ts"
import { nativeWorktreeError, PROJECT } from "./helpers/fakes.ts"

describe("gateway error normalization", () => {
  test("native WorktreeError bodies become WorktreeFailure with forceRequired", () => {
    const failure = normalizeTransportError(nativeWorktreeError("worktree is dirty", true))
    expect(isWorktreeFailure(failure)).toBe(true)
    expect(failure.message).toBe("worktree is dirty")
    expect(failure.forceRequired).toBe(true)
  })

  test("forceRequired=null native hint maps to undefined, not true", () => {
    const failure = normalizeTransportError({ name: "WorktreeError", data: { message: "locked", forceRequired: null } })
    expect(failure.forceRequired).toBeUndefined()
  })

  test("generic errors keep their message", () => {
    const failure = normalizeTransportError(new Error("boom"))
    expect(failure.message).toBe("boom")
  })

  test("non-error throwables are stringified", () => {
    expect(normalizeTransportError("plain string").message).toBe("plain string")
  })
})

describe("WorktreeGateway", () => {
  test("uses the native plugin domain at the bound location for every operation", async () => {
    const calls: { operation: string; input: unknown }[] = []
    const directory = "/worktrees/task"
    const worktree: WorktreeApi = {
      async list(input) {
        calls.push({ operation: "list", input })
        return [{ directory: PROJECT.directory }, { directory, strategy: "git" }]
      },
      async create(input) {
        calls.push({ operation: "create", input })
        return { directory }
      },
      async remove(input) { calls.push({ operation: "remove", input }) },
      async refresh(input) { calls.push({ operation: "refresh", input }) },
    }
    const gateway = new WorktreeGateway({ project: PROJECT, worktree })
    const location = { directory: PROJECT.directory }

    expect(await gateway.list({ projectID: PROJECT.id })).toEqual([
      { directory: PROJECT.directory }, { directory, strategy: "git" },
    ])
    expect(await gateway.create({ projectID: PROJECT.id, strategy: "git", directory: "/worktrees", name: "task", baseRef: "origin/pr-209" })).toEqual({ directory })
    await gateway.remove({ projectID: PROJECT.id, directory, force: false })
    await gateway.refresh({ projectID: PROJECT.id })

    expect(calls).toEqual([
      { operation: "list", input: { projectID: PROJECT.id, location } },
      { operation: "create", input: { projectID: PROJECT.id, location, strategy: "git", directory: "/worktrees", name: "task", branch: "origin/pr-209" } },
      { operation: "remove", input: { projectID: PROJECT.id, location, directory, force: false } },
      { operation: "refresh", input: { projectID: PROJECT.id, location } },
    ])
  })

  test("omitted baseRef defaults to HEAD because the native domain requires a string branch", async () => {
    const calls: { operation: string; input: unknown }[] = []
    const directory = "/worktrees/task"
    const worktree: WorktreeApi = {
      async list() { return [] },
      async create(input) {
        calls.push({ operation: "create", input })
        return { directory }
      },
      async remove() {},
      async refresh() {},
    }
    const gateway = new WorktreeGateway({ project: PROJECT, worktree })

    expect(await gateway.create({ projectID: PROJECT.id, strategy: "git", directory: "/worktrees", name: "task" })).toEqual({ directory })
    expect(calls).toEqual([
      { operation: "create", input: { projectID: PROJECT.id, location: { directory: PROJECT.directory }, strategy: "git", directory: "/worktrees", name: "task", branch: "HEAD" } },
    ])
  })

  test("rejects cross-project operations before discovering or contacting a server", async () => {
    const gateway = new WorktreeGateway({ project: PROJECT, serverUrl: "http://127.0.0.1:9" })
    const projectID = "prj_other"
    await expect(gateway.list({ projectID })).rejects.toThrow("unknown project")
    await expect(gateway.create({ projectID, strategy: "git", directory: "/worktrees" })).rejects.toThrow("unknown project")
    await expect(gateway.remove({ projectID, directory: "/worktrees/task", force: false })).rejects.toThrow("unknown project")
    await expect(gateway.refresh({ projectID })).rejects.toThrow("unknown project")
  })

  test("explicit server uses location-scoped HTTP routes and preserves the starting ref and force flag", async () => {
    const project = { id: PROJECT.id, directory: "E:\\Projects\\repo with spaces" }
    const directory = "E:\\Worktrees\\task"
    const requests: { method: string; path: string; query: Record<string, string>; body?: unknown }[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        requests.push({
          method: request.method,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          body: request.body ? await request.json() : undefined,
        })
        if (url.searchParams.get("location[directory]") !== project.directory) {
          return Response.json({ message: "wrong location" }, { status: 400 })
        }
        if (url.pathname === "/api/worktree") {
          if (request.method === "GET") return Response.json([{ directory: project.directory }])
          if (request.method === "POST") return Response.json({ directory })
          if (request.method === "DELETE") return Response.json(nativeWorktreeError("worktree is dirty", true), { status: 400 })
        }
        if (url.pathname === "/api/worktree/refresh" && request.method === "POST") return new Response(null, { status: 204 })
        return new Response(null, { status: 404 })
      },
    })
    const unexpectedNativeCall = async (): Promise<never> => { throw new Error("explicit server must take precedence") }
    const gateway = new WorktreeGateway({
      project,
      serverUrl: `http://localhost:${server.port}`,
      worktree: { list: unexpectedNativeCall, create: unexpectedNativeCall, remove: unexpectedNativeCall, refresh: unexpectedNativeCall },
    })

    try {
      expect(await gateway.list({ projectID: project.id })).toEqual([{ directory: project.directory }])
      expect(await gateway.create({ projectID: project.id, strategy: "git", directory: "E:\\Worktrees", name: "task", baseRef: "origin/pr-209" })).toEqual({ directory })
      await expect(gateway.remove({ projectID: project.id, directory, force: false })).rejects.toMatchObject({
        message: "worktree is dirty", forceRequired: true, nativeName: "WorktreeError",
      })
      await gateway.refresh({ projectID: project.id })

      const query = { "location[directory]": project.directory }
      expect(requests).toEqual([
        { method: "GET", path: "/api/worktree", query, body: undefined },
        { method: "POST", path: "/api/worktree", query, body: { strategy: "git", directory: "E:\\Worktrees", name: "task", branch: "origin/pr-209" } },
        { method: "DELETE", path: "/api/worktree", query, body: { directory, force: false } },
        { method: "POST", path: "/api/worktree/refresh", query, body: undefined },
      ])
    } finally {
      await server.stop(true)
    }
  })

  test("explicit serverUrl is honored and transport failures are normalized deterministically", async () => {
    // Port 9 (discard) with nothing listening: deterministic transport failure.
    const gateway = new WorktreeGateway({ project: PROJECT, serverUrl: "http://127.0.0.1:9" })
    const error = await gateway.list({ projectID: PROJECT.id }).then(
      () => null,
      (e) => e,
    )
    expect(error).toBeInstanceOf(WorktreeFailure)
    expect((error as WorktreeFailure).message).toContain("OpenCode")
  })
})
