// Real git repository behind a stand-in for OpenCode's `ctx.worktree` domain.
// Git runs only inside the stand-in (playing OpenCode), never in the plugin.

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
import { nativeWorktreeError, output, PROJECT, toolContext } from "../helpers/fakes.ts"
import type { NativeWorktreeApi } from "../../src/opencode/types.ts"

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

/** Stand-in for the native worktree domain, backed by real git like OpenCode's git strategy. */
function makeNativeApi(repo: string, defaultParent: string) {
  const createInputs: Record<string, unknown>[] = []
  const fail = (message: string, forceRequired?: boolean) => nativeWorktreeError(message, forceRequired)

  async function managedEntries(): Promise<{ directory: string; strategy?: string }[]> {
    const porcelain = await git(repo, "worktree", "list", "--porcelain")
    const entries: { directory: string; strategy?: string }[] = []
    for (const block of porcelain.split("\n\n")) {
      const line = block.split("\n").find((l) => l.startsWith("worktree "))
      if (!line) continue
      const directory = resolve(line.slice("worktree ".length).trim())
      entries.push(entries.length === 0 ? { directory } : { directory, strategy: "git" })
    }
    return entries
  }

  const api: NativeWorktreeApi = {
    async list(input) {
      if (input.projectID !== PROJECT.id) throw fail("wrong project")
      return managedEntries()
    },
    async create(input) {
      if (input.projectID !== PROJECT.id) throw fail("wrong project")
      createInputs.push({ ...input })
      const target = resolve(join(input.directory ?? defaultParent, input.name ?? "worktree"))
      try {
        await git(repo, "worktree", "add", "--detach", "--", target, input.branch ?? "HEAD")
      } catch (e) {
        throw fail(e instanceof Error ? e.message : String(e))
      }
      return { directory: target }
    },
    async remove(input) {
      if (input.projectID !== PROJECT.id) throw fail("wrong project")
      const dirty = (await git(input.directory, "status", "--porcelain").catch(() => "M fake")).trim() !== ""
      if (dirty && !input.force) throw fail("worktree contains modified or untracked files", true)
      await git(repo, "worktree", "remove", input.directory, ...(input.force ? ["--force"] : []))
    },
    async refresh() {},
  }
  return { api, createInputs }
}

describe.skipIf(!gitAvailable)("integration: temp git repository through the native worktree bridge", () => {
  const base = mkdtempSync(join(tmpdir(), "opencode-better-worktrees-it-"))
  const repo = join(base, "repo")
  const worktreeRoot = join(base, "worktrees")

  const defaultParent = join(base, "opencode-default")
  const { api, createInputs } = makeNativeApi(repo, defaultParent)
  const deps: ToolDeps = {
    project: { id: PROJECT.id, directory: repo, canonical: repo },
    worktrees: new WorktreeGateway({ projectID: () => PROJECT.id, worktree: api }),
    sessions: {
      get: async () => ({ id: "ses_main", projectID: PROJECT.id, directory: repo }),
      move: async () => {},
    },
    vcs: makeGitVcs(),
    fs: { exists: fsExists },
    options: resolveOptions({ directoryRoot: worktreeRoot }),
    locks: new KeyedMutex(),
  }

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
    expect(createInputs).toEqual([{ projectID: PROJECT.id, name: "it-auth", directory: resolve(worktreeRoot) }])

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

  test("without directoryRoot the worktree lands where OpenCode puts it", async () => {
    const created = await output<{ directory: string }>(
      buildCreateTool({ ...deps, options: resolveOptions({}) }),
      { name: "it-default" },
    )
    expect(created.directory).toBe(resolve(defaultParent, "it-default"))
    expect(existsSync(join(created.directory, "README.md"))).toBe(true)
    const removed = await output<{ removed: boolean }>(buildRemoveTool(deps), { worktree: "it-default" })
    expect(removed.removed).toBe(true)
  })

  test("cleanup", () => {
    rmSync(base, { recursive: true, force: true })
  })
})
