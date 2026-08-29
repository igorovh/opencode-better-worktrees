/**
 * Test doubles for the OpenCode API layer. No HTTP and no git in unit tests:
 * the wrappers behind `ToolDeps` are faked, which keeps tool logic the only
 * thing under test. The integration test (integration/git-repo.test.ts) is the
 * place where the real generated client talks to an HTTP server.
 */

import { KeyedMutex } from "../../src/utils/mutex.ts"
import { resolveOptions, type Options } from "../../src/options.ts"
import type { ToolDeps, ToolExecutionContext } from "../../src/tools/shared.ts"
import type {
  FileChange,
  FsLike,
  ManagedWorktree,
  SessionsLike,
  SessionSnapshot,
  VcsLike,
  WorktreeCreateRequest,
  WorktreeTransport,
} from "../../src/opencode/types.ts"

export const PROJECT = { id: "prj_test", directory: "/repo", canonical: "/repo" } as const

export class FakeWorktrees implements WorktreeTransport {
  entries: ManagedWorktree[] = []
  createCalls: WorktreeCreateRequest[] = []
  removeCalls: { projectID: string; directory: string; force: boolean }[] = []
  refreshCalls: string[] = []
  /** Thrown (verbatim, like the generated client does for declared statuses) by remove when set. */
  removeError?: unknown
  createError?: unknown

  async list(input: { projectID: string }): Promise<readonly ManagedWorktree[]> {
    if (input.projectID !== PROJECT.id) throw new Error(`unknown project ${input.projectID}`)
    return [...this.entries]
  }

  async create(input: WorktreeCreateRequest): Promise<{ directory: string }> {
    if (input.projectID !== PROJECT.id) throw new Error(`unknown project ${input.projectID}`)
    this.createCalls.push(input)
    if (this.createError) throw this.createError
    // Mimics the verified native contract: the worktree lives at <parent>/<leaf>.
    const directory = input.name ? `${input.directory}/${input.name}`.replace(/\/+/g, "/") : input.directory
    this.entries = [...this.entries, { directory, strategy: input.strategy }]
    return { directory }
  }

  async remove(input: { projectID: string; directory: string; force: boolean }): Promise<void> {
    if (input.projectID !== PROJECT.id) throw new Error(`unknown project ${input.projectID}`)
    this.removeCalls.push(input)
    if (this.removeError) throw this.removeError
    this.entries = this.entries.filter((entry) => entry.directory !== input.directory)
  }

  async refresh(input: { projectID: string }): Promise<void> {
    this.refreshCalls.push(input.projectID)
  }
}

export class FakeSessions implements SessionsLike {
  private readonly sessions = new Map<string, SessionSnapshot>()
  private nextID = 1
  readonly moves: { sessionID: string; directory: string }[] = []
  readonly prompts: { sessionID: string; text: string }[] = []
  readonly waits: string[] = []

  constructor(
    private readonly projectID: string = PROJECT.id,
    initial?: SessionSnapshot,
  ) {
    if (initial) this.sessions.set(initial.id, initial)
  }

  /** Register an extra session (e.g. one belonging to a foreign project). */
  add(snapshot: SessionSnapshot): void {
    this.sessions.set(snapshot.id, snapshot)
  }

  async get(sessionID: string): Promise<SessionSnapshot> {
    const session = this.sessions.get(sessionID)
    if (!session) throw new Error(`session not found: ${sessionID}`)
    return session
  }

  async createAtLocation(input: { title?: string; directory: string }): Promise<SessionSnapshot> {
    const snapshot: SessionSnapshot = {
      id: `ses_${this.nextID++}`,
      projectID: this.projectID,
      directory: input.directory,
      title: input.title,
    }
    this.sessions.set(snapshot.id, snapshot)
    return snapshot
  }

  async move(sessionID: string, directory: string): Promise<void> {
    const session = await this.get(sessionID)
    this.moves.push({ sessionID, directory })
    this.sessions.set(sessionID, { ...session, directory })
  }

  async prompt(sessionID: string, text: string): Promise<unknown> {
    this.prompts.push({ sessionID, text })
    return { sessionID, text }
  }

  async wait(sessionID: string): Promise<void> {
    this.waits.push(sessionID)
  }
}

/** Lower-cased absolute path keys, mirroring the platform comparison rule. */
function key(directory: string): string {
  return directory.toLowerCase()
}

export class FakeVcs implements VcsLike {
  readonly branchInfo = new Map<string, { current?: string; default?: string }>()
  readonly changes = new Map<string, FileChange[]>()

  setBranch(directory: string, branch: { current?: string; default?: string }): void {
    this.branchInfo.set(key(directory), branch)
  }

  setChanges(directory: string, changes: FileChange[]): void {
    this.changes.set(key(directory), changes)
  }

  async info(directory: string): Promise<{ current?: string; default?: string } | undefined> {
    return this.branchInfo.get(key(directory))
  }

  async status(directory: string): Promise<readonly FileChange[]> {
    return this.changes.get(key(directory)) ?? []
  }

  async diff(directory: string): Promise<readonly (FileChange & { patch: string })[]> {
    return (this.changes.get(key(directory)) ?? []).map((change) => ({ ...change, patch: `--- a/${change.file}` }))
  }
}

export class FakeFs implements FsLike {
  readonly existing = new Set<string>()

  add(path: string): void {
    this.existing.add(key(path))
  }

  async exists(path: string): Promise<boolean> {
    return this.existing.has(key(path))
  }
}

export class FakeAgents {
  readonly known = new Set<string>(["build", "plan"])

  async get(agentID: string): Promise<unknown> {
    if (!this.known.has(agentID)) throw new Error(`agent not found: ${agentID}`)
    return { id: agentID }
  }
}

export interface Harness {
  deps: ToolDeps
  options: Options
  worktrees: FakeWorktrees
  sessions: FakeSessions
  vcs: FakeVcs
  fs: FakeFs
  agents: FakeAgents
}

export function makeHarness(overrides?: { options?: Record<string, unknown>; initialSession?: SessionSnapshot }): Harness {
  const options = resolveOptions(overrides?.options ?? {})
  const worktrees = new FakeWorktrees()
  const sessions = new FakeSessions(PROJECT.id, overrides?.initialSession ?? { id: "ses_main", projectID: PROJECT.id, directory: PROJECT.directory })
  const vcs = new FakeVcs()
  const fs = new FakeFs()
  const agents = new FakeAgents()
  const deps: ToolDeps = {
    project: PROJECT,
    worktrees,
    sessions,
    vcs,
    fs,
    agents,
    options,
    locks: new KeyedMutex(),
  }
  return { deps, options, worktrees, sessions, vcs, fs, agents }
}

/** Executor context stub, like the one OpenCode hands to tool executors. */
export function toolContext(sessionID = "ses_main"): ToolExecutionContext {
  return {
    sessionID,
    agent: "build",
    messageID: "msg_1",
    id: "call_1",
    progress: async () => {},
  }
}

/** Run a tool and return its structured output. */
export async function output<T = Record<string, unknown>>(tool: { execute: (input: unknown, tool: ToolExecutionContext) => Promise<{ output?: Record<string, unknown> }> }, input: unknown, sessionID?: string): Promise<T> {
  const result = await tool.execute(input, toolContext(sessionID))
  return result.output as T
}

/** Run a tool and return its full result (output + content). */
export async function result(tool: { execute: (input: unknown, tool: ToolExecutionContext) => Promise<{ output?: Record<string, unknown>; content?: unknown }> }, input: unknown, sessionID?: string) {
  return tool.execute(input, toolContext(sessionID))
}

/**
 * A native WorktreeError body, exactly like the generated client throws for
 * the declared 400 response of the worktree routes.
 */
export function nativeWorktreeError(message: string, forceRequired?: boolean): { name: "WorktreeError"; data: { message: string; forceRequired?: boolean } } {
  return { name: "WorktreeError", data: { message, forceRequired } }
}
