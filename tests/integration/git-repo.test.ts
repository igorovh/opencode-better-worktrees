/**
 * Integration test: real Git repository + a stand-in OpenCode native server
 * implementing the exact verified wire contract of the V2 worktree routes
 * (backed by real `git worktree` operations, as OpenCode's `git_worktree`
 * strategy does), exercised through the REAL generated OpenCode client via
 * the plugin's gateway.
 *
 * This validates: request serialization of the generated client, status-code
 * handling (200/204/400), native WorktreeError decoding (forceRequired),
 * gateway normalization, plugin path/name handling, and safe removal —
 * end to end, with real Git semantics. Git is used here ONLY inside the fake
 * server (playing the role of OpenCode itself), never by the plugin.
 */

import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { WorktreeGateway } from "../../src/opencode/gateway.ts"
import type { ToolDeps } from "../../src/tools/shared.ts"
import { buildCreateTool } from "../../src/tools/create.ts"
import { buildListTool } from "../../src/tools/list.ts"
import { buildStatusTool } from "../../src/tools/status.ts"
import { buildRemoveTool } from "../../src/tools/remove.ts"
import { KeyedMutex } from "../../src/utils/mutex.ts"
import { resolveOptions } from "../../src/options.ts"
import { exists as fsExists } from "../../src/utils/fs.ts"
import { output, PROJECT, toolContext } from "../helpers/fakes.ts"

const gitAvailable = await Bun.$`git --version`.nothrow().then(() => true, () => false)

/** Minimal git helper: throws on non-zero exit with stderr in the message. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  // Bun.$ resolves `git` through the shell (robust on Windows where raw
  // spawn of an absolute .exe path with spaces can fail) and escapes args.
  const result = await Bun.$`git ${args}`.cwd(cwd).nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.exitCode}): ${result.stderr.toString().trim()}`)
  }
  return result.stdout.toString()
}

/** Real-git VCS provider implementing the plugin's VcsLike, used for status assertions. */
function makeGitVcs() {
  return {
    async info(directory: string) {
      try {
        const current = (await git(directory, "branch", "--show-current")).trim()
        return { current: current || "(detached)", default: "main" }
      } catch {
        return undefined
      }
    },
    async status(directory: string) {
      const porcelain = await git(directory, "status", "--porcelain")
      return porcelain
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => {
          const marker = line.slice(0, 2).trim()
          const file = line.slice(3).trim()
          const status = marker === "??" ? ("added" as const) : marker.includes("D") ? ("deleted" as const) : marker.includes("A") ? ("added" as const) : ("modified" as const)
          return { file, additions: 1, deletions: 0, status }
        })
    },
    async diff(directory: string) {
      const changes = await this.status(directory)
      return changes.map((change) => ({ ...change, patch: `--- a/${change.file}` }))
    },
  }
}

/** Stand-in for OpenCode's native worktree routes, backed by real git.
 * The server picks the strategy from project configuration, so requests carry none. */
function makeNativeServer(repo: string) {
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })
  const error = (message: string, forceRequired?: boolean) =>
    json({ _tag: "WorktreeError", name: "WorktreeError", data: { message, forceRequired } }, 400)
  const createBodies: Record<string, unknown>[] = []

  async function managedEntries(): Promise<{ directory: string; strategy?: string }[]> {
    const porcelain = await git(repo, "worktree", "list", "--porcelain")
    const entries: { directory: string; strategy?: string }[] = []
    let first = true
    for (const block of porcelain.split("\n\n")) {
      const line = block.split("\n").find((l) => l.startsWith("worktree "))
      if (!line) continue
      const directory = resolve(line.slice("worktree ".length).trim())
      entries.push(first ? { directory } : { directory, strategy: "git" })
      first = false
    }
    return entries
  }

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const route = url.pathname

      if (request.method === "GET" && route === "/api/worktree") {
        if (url.searchParams.get("projectID") !== PROJECT.id) return error("wrong project")
        return json(await managedEntries())
      }

      const body = request.body ? ((await request.json()) as Record<string, unknown>) : {}
      if (body.projectID !== PROJECT.id) return error("wrong project")

      if (request.method === "POST" && route === "/api/worktree") {
        createBodies.push(body)
        const { directory, name, branch } = body as { directory?: string; name?: string; branch?: string }
        if (!directory || !name) return error("directory and name are required")
        // Verified beta semantics: parent dir + leaf name, detached at an
        // existing ref (`branch`) or HEAD.
        const target = resolve(join(directory, name))
        const ref = branch ?? "HEAD"
        try {
          await git(repo, "worktree", "add", "--detach", "--", target, ref)
          return json({ directory: target })
        } catch (e) {
          return error(e instanceof Error ? e.message : String(e))
        }
      }

      if (request.method === "DELETE" && route === "/api/worktree") {
        const { directory, force } = body as { directory?: string; force?: boolean }
        if (!directory) return error("directory is required")
        const dirty = (await git(directory, "status", "--porcelain").catch(() => "M fake")).trim() !== ""
        if (dirty && !force) {
          return error("worktree contains modified or untracked files", true)
        }
        try {
          await git(repo, "worktree", "remove", directory, ...(force ? ["--force"] : []))
          return new Response(null, { status: 204 })
        } catch (e) {
          return error(e instanceof Error ? e.message : String(e))
        }
      }

      if (request.method === "POST" && route === "/api/worktree/refresh") return new Response(null, { status: 204 })

      return json({ message: `no route: ${request.method} ${url.pathname}` }, 404)
    },
  })
  return { server, createBodies }
}

describe.skipIf(!gitAvailable)("integration: temp git repository through the native worktree bridge", () => {
  const base = mkdtempSync(join(tmpdir(), "opencode2-worktrees-it-"))
  const repo = join(base, "repo")
  const worktreeRoot = join(base, "worktrees")

  const deps: ToolDeps = {
    project: { id: PROJECT.id, directory: repo, canonical: repo },
    // Replaced with the HTTP-backed gateway right after the server starts below.
    worktrees: new WorktreeGateway({ project: { id: PROJECT.id }, serverUrl: "http://127.0.0.1:1" }),
    sessions: {
      get: async () => ({ id: "ses_main", projectID: PROJECT.id, directory: repo }),
      createAtLocation: async () => ({ id: "ses_spawned", projectID: PROJECT.id, directory: repo }),
      move: async () => {},
      prompt: async () => ({}),
      wait: async () => {},
    },
    vcs: makeGitVcs(),
    fs: { exists: fsExists },
    agents: { get: async (agentID) => ({ id: agentID }) },
    options: resolveOptions({ directoryRoot: worktreeRoot }),
    locks: new KeyedMutex(),
  }

  const { server, createBodies } = makeNativeServer(repo)
  // Real generated OpenCode client talking over HTTP to the stand-in server.
  ;(deps as { worktrees: unknown }).worktrees = new WorktreeGateway({
    project: { id: PROJECT.id },
    serverUrl: `http://localhost:${server.port}`,
  })

  test("create → list → status → refuse dirty removal → forced removal, against real git", async () => {
    // Arrange a real repository with an initial commit.
    mkdirSync(repo, { recursive: true })
    await git(repo, "init", "-b", "main")
    await git(repo, "config", "user.email", "test@example.com")
    await git(repo, "config", "user.name", "Test")
    writeFileSync(join(repo, "README.md"), "# Integration\n")
    await git(repo, "add", ".")
    await git(repo, "commit", "-m", "initial")

    // 1) Create through the plugin tool → real git worktree on disk (detached).
    const created = await output<{ directory: string; branch?: string }>(buildCreateTool(deps), { name: "it-auth" })
    expect(created.branch).toBe("agent/it-auth") // suggested work branch
    expect(existsSync(created.directory)).toBe(true)
    expect(existsSync(join(created.directory, "README.md"))).toBe(true) // setup/checkout ran
    expect(createBodies).toEqual([{ projectID: PROJECT.id, directory: resolve(worktreeRoot), name: "it-auth" }])

    // The agent (never the plugin) creates the work branch before committing.
    await git(created.directory, "switch", "-c", "agent/it-auth")
    expect(await git(created.directory, "branch", "--show-current")).toContain("agent/it-auth")

    // 2) Native list shows root + managed entry with the accepted strategy.
    const listed = await output<{ worktrees: { kind: string; name: string }[] }>(buildListTool(deps), {})
    expect(listed.worktrees).toHaveLength(2)
    expect(listed.worktrees[0]).toMatchObject({ kind: "root" })
    expect(listed.worktrees[1]).toMatchObject({ name: "it-auth", kind: "managed" })

    // 3) Make the worktree dirty; status must report it (real git status).
    writeFileSync(join(created.directory, "src.txt"), "changes")
    const status = await output<{ clean: boolean; changes: number; branch?: string }>(buildStatusTool(deps), { worktree: "it-auth" })
    expect(status.clean).toBe(false)
    expect(status.changes).toBe(1)
    expect(status.branch).toContain("agent/it-auth")

    // 4) Removal is refused natively with forceRequired (WorktreeError over HTTP).
    const removeTool = buildRemoveTool(deps)
    const refused = await removeTool.execute({ worktree: "it-auth" }, toolContext())
    expect(refused.output).toMatchObject({ removed: false, forceRequired: true })
    expect(existsSync(created.directory)).toBe(true)

    // 5) Explicit force removes the worktree for real.
    const forced = await output<{ removed: boolean }>(removeTool, { worktree: "it-auth", force: true })
    expect(forced.removed).toBe(true)
    expect(existsSync(created.directory)).toBe(false)

    // 6) Back to exactly the root worktree.
    const finalList = await output<{ worktrees: unknown[] }>(buildListTool(deps), {})
    expect(finalList.worktrees).toHaveLength(1)
  })

  test("cleanup", () => {
    server.stop(true)
    rmSync(base, { recursive: true, force: true })
  })
})
