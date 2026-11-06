// Small interfaces over the OpenCode plugin context, so tests can substitute fakes.

/** One entry of the native worktree list. */
export interface ManagedWorktree {
  readonly directory: string
  /** Present for managed copies, absent for the project root. */
  readonly strategy?: string
}

/** The subset of `ctx.worktree` this plugin calls (OpenCode 2.2.5 contract). */
export interface NativeWorktreeApi {
  list(input: { projectID: string }): Promise<readonly ManagedWorktree[]>
  create(input: { projectID: string; directory?: string; name?: string; branch?: string }): Promise<{ directory: string }>
  remove(input: { projectID: string; directory: string; force: boolean }): Promise<void>
  refresh(input: { projectID: string }): Promise<void>
}

export interface WorktreeCreateRequest {
  readonly projectID: string
  /** Parent directory; omitted to let OpenCode pick its per-project worktree location. */
  readonly directory?: string
  readonly name: string
  /** Existing ref to detach the worktree at; the server defaults to HEAD. */
  readonly baseRef?: string
}

export interface WorktreeTransport {
  list(input: { projectID: string }): Promise<readonly ManagedWorktree[]>
  create(input: WorktreeCreateRequest): Promise<{ directory: string }>
  remove(input: { projectID: string; directory: string; force: boolean }): Promise<void>
  refresh(input: { projectID: string }): Promise<void>
}

export interface SessionSnapshot {
  readonly id: string
  readonly projectID: string
  readonly directory: string
}

export interface SessionsLike {
  get(sessionID: string): Promise<SessionSnapshot>
  move(sessionID: string, directory: string): Promise<void>
}

export interface FileChange {
  readonly file: string
  readonly additions: number
  readonly deletions: number
  readonly status: "added" | "deleted" | "modified"
}

export interface VcsLike {
  /** Branch info, or `undefined` when the directory has no VCS. */
  info(directory: string): Promise<{ current?: string; default?: string } | undefined>
  status(directory: string): Promise<readonly FileChange[]>
  diff(directory: string, context?: number): Promise<readonly (FileChange & { patch: string })[]>
}

export interface FsLike {
  exists(path: string): Promise<boolean>
}
