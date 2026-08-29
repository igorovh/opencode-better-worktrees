/**
 * Shared transport-level types for the OpenCode API wrappers.
 *
 * Everything the tools need from OpenCode is expressed through these small
 * interfaces so tests can substitute fakes and so a future beta API change
 * only requires touching `src/opencode/`.
 */

/** One entry of the native `v2.worktree.list` response (`Worktree.Directory`). */
export interface ManagedWorktree {
  /** Absolute directory of the worktree. */
  readonly directory: string
  /** Native strategy id. Present for managed copies, absent for the project root. */
  readonly strategy?: string
}

/**
 * Input of the native `v2.worktree.create` call, verified against the running
 * `0.0.0-beta-18684` server:
 * - `directory` is the PARENT directory and `name` the leaf under it (the
 *   server joins them, suffixing the name on collisions);
 * - `branch` is an EXISTING ref that the server attaches the worktree to in
 *   detached mode (`--detach -- <dir> <ref>`); it does NOT create a branch;
 * - `from` would override the source directory and is not used by this plugin.
 * The created worktree is always in detached HEAD; the agent creates a branch
 * inside it before committing (see the tool output and injected instructions).
 */
export interface WorktreeCreateRequest {
  readonly projectID: string
  readonly strategy: string
  /** Parent directory under which the worktree directory is created. */
  readonly directory: string
  /** Leaf directory name of the worktree. */
  readonly name?: string
  /** Existing ref to detach the worktree at (defaults to the server's HEAD). */
  readonly baseRef?: string
}

/**
 * The native Worktree HTTP API surface used by this plugin
 * (`v2.worktree.list/create/remove/refresh`).
 */
export interface WorktreeTransport {
  list(input: { projectID: string }): Promise<readonly ManagedWorktree[]>
  create(input: WorktreeCreateRequest): Promise<{ directory: string }>
  remove(input: { projectID: string; directory: string; force: boolean }): Promise<void>
  refresh(input: { projectID: string }): Promise<void>
}

/** The session fields this plugin relies on (`Session.Info` subset). */
export interface SessionSnapshot {
  readonly id: string
  readonly projectID: string
  readonly directory: string
  readonly title?: string
}

/** Session operations, backed by the plugin context's native session domain. */
export interface SessionsLike {
  get(sessionID: string): Promise<SessionSnapshot>
  createAtLocation(input: {
    title?: string
    agent?: string
    model?: { providerID: string; id: string }
    directory: string
  }): Promise<SessionSnapshot>
  move(sessionID: string, directory: string): Promise<void>
  prompt(sessionID: string, text: string): Promise<unknown>
  wait(sessionID: string): Promise<void>
}

/** One file entry of the native location-scoped VCS status. */
export interface FileChange {
  readonly file: string
  readonly additions: number
  readonly deletions: number
  readonly status: "added" | "deleted" | "modified"
}

/** Location-scoped VCS operations, backed by the plugin context's VCS domain. */
export interface VcsLike {
  /** Branch information for a directory, or `undefined` when no VCS applies. */
  info(directory: string): Promise<{ current?: string; default?: string } | undefined>
  /** Working-copy status for a directory; empty array when clean. */
  status(directory: string): Promise<readonly FileChange[]>
  /** Working-copy diff for a directory. */
  diff(directory: string, context?: number): Promise<readonly (FileChange & { patch: string })[]>
}

/** Minimal file-system probe, injectable for tests. */
export interface FsLike {
  exists(path: string): Promise<boolean>
}
