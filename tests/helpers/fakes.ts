// Fakes behind `ToolDeps`; integration/git-repo.test.ts covers real git.

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
    // Native contract: <parent>/<name>, or OpenCode's own per-project location without a parent.
    const directory = `${input.directory ?? "/opencode/worktree/prj"}/${input.name}`.replace(/\/+/g, "/")
    this.entries = [...this.entries, { directory, strategy: "git" }]
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
  readonly moves: { sessionID: string; directory: string }[] = []

  constructor(initial?: SessionSnapshot) {
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

  async move(sessionID: string, directory: string): Promise<void> {
    const session = await this.get(sessionID)
    this.moves.push({ sessionID, directory })
    this.sessions.set(sessionID, { ...session, directory })
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

export interface Harness {
  deps: ToolDeps
  options: Options
  worktrees: FakeWorktrees
  sessions: FakeSessions
  vcs: FakeVcs
  fs: FakeFs
}

export function makeHarness(overrides?: { options?: Record<string, unknown>; initialSession?: SessionSnapshot }): Harness {
  const options = resolveOptions(overrides?.options ?? {})
  const worktrees = new FakeWorktrees()
  const sessions = new FakeSessions(overrides?.initialSession ?? { id: "ses_main", projectID: PROJECT.id, directory: PROJECT.directory })
  const vcs = new FakeVcs()
  const fs = new FakeFs()
  const deps: ToolDeps = {
    project: PROJECT,
    worktrees,
    sessions,
    vcs,
    fs,
    options,
    locks: new KeyedMutex(),
  }
  return { deps, options, worktrees, sessions, vcs, fs }
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
export function nativeWorktreeError(message: string, forceRequired?: boolean): { _tag: "WorktreeError"; name: "WorktreeError"; data: { message: string; forceRequired?: boolean } } {
  return { _tag: "WorktreeError", name: "WorktreeError", data: { message, forceRequired } }
}
