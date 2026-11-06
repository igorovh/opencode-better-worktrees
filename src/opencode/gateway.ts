// Bridge to the native `ctx.worktree` domain. This plugin never runs `git worktree` itself.

import { WorktreeFailure } from "../utils/errors.ts"
import type { ManagedWorktree, NativeWorktreeApi, WorktreeCreateRequest, WorktreeTransport } from "./types.ts"

function isHttpWorktreeError(error: unknown): error is { data: { message: string; forceRequired?: boolean | null } } {
  if (typeof error !== "object" || error === null) return false
  const candidate = error as { name?: unknown; data?: { message?: unknown } }
  return candidate.name === "WorktreeError" && typeof candidate.data?.message === "string"
}

function isOperationError(error: unknown): error is { message: string; forceRequired?: boolean | null } {
  if (typeof error !== "object" || error === null) return false
  const candidate = error as { _tag?: unknown; message?: unknown }
  return candidate._tag === "Worktree.OperationError" && typeof candidate.message === "string"
}

/** Normalize any thrown value from the native domain into a `WorktreeFailure`. */
export function normalizeTransportError(error: unknown): WorktreeFailure {
  if (error instanceof WorktreeFailure) return error
  if (isHttpWorktreeError(error)) {
    return new WorktreeFailure({
      message: error.data.message,
      forceRequired: error.data.forceRequired ?? undefined,
      nativeName: "WorktreeError",
    })
  }
  if (isOperationError(error)) {
    return new WorktreeFailure({
      message: error.message,
      forceRequired: error.forceRequired ?? undefined,
      nativeName: "WorktreeError",
    })
  }
  if (error instanceof Error) return new WorktreeFailure({ message: error.message, nativeName: error.name })
  return new WorktreeFailure({ message: String(error) })
}

/** The server rejects calls whose project it has not resolved yet; a refresh registers it. */
function isUnresolvedProject(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String((error as { _tag?: unknown })?._tag ?? error)
  return /missing key|projectnotfound|project not found/i.test(text)
}

export class WorktreeGateway implements WorktreeTransport {
  constructor(private readonly options: { projectID: () => string; worktree: NativeWorktreeApi }) {}

  private checked(projectID: string): string {
    const current = this.options.projectID()
    if (typeof current !== "string" || current === "") {
      throw new WorktreeFailure({ message: "OpenCode has not assigned a project to this location yet. Open a Git repository and retry." })
    }
    if (projectID !== current) {
      throw new WorktreeFailure({ message: `Worktree access requested for an unknown project: ${projectID}.` })
    }
    return current
  }

  private async call<T>(projectID: string, run: (projectID: string) => Promise<T>): Promise<T> {
    const id = this.checked(projectID)
    try {
      return await run(id)
    } catch (error) {
      if (!isUnresolvedProject(error)) throw normalizeTransportError(error)
    }
    try {
      await this.options.worktree.refresh({ projectID: id })
      return await run(id)
    } catch (error) {
      throw normalizeTransportError(error)
    }
  }

  async list(input: { projectID: string }): Promise<readonly ManagedWorktree[]> {
    const entries = await this.call(input.projectID, (projectID) => this.options.worktree.list({ projectID }))
    return (entries ?? []).map((entry) => ({ directory: entry.directory, strategy: entry.strategy }))
  }

  async create(input: WorktreeCreateRequest): Promise<{ directory: string }> {
    const result = await this.call(input.projectID, (projectID) =>
      this.options.worktree.create({
        projectID,
        name: input.name,
        ...(input.directory === undefined ? {} : { directory: input.directory }),
        ...(input.baseRef === undefined ? {} : { branch: input.baseRef }),
      }),
    )
    return { directory: result.directory }
  }

  async remove(input: { projectID: string; directory: string; force: boolean }): Promise<void> {
    await this.call(input.projectID, (projectID) =>
      this.options.worktree.remove({ projectID, directory: input.directory, force: input.force }),
    )
  }

  async refresh(input: { projectID: string }): Promise<void> {
    const projectID = this.checked(input.projectID)
    try {
      await this.options.worktree.refresh({ projectID })
    } catch (error) {
      throw normalizeTransportError(error)
    }
  }
}
