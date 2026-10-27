/**
 * Bridge to OpenCode's native Worktree API (`v2.worktree.*`).
 *
 * Uses the plugin's native worktree domain unless an explicit serverUrl is
 * configured. Standalone callers can discover the shared service read-only.
 * Operations are scoped by projectID; the server picks the project's strategy.
 *
 * All worktree lifecycle management goes through the native API. This module
 * never shells out to `git worktree`.
 */

import { isWorktreeError, OpenCode } from "@opencode/client"
import type { WorktreeApi } from "@opencode/client/promise/api"
import { Service } from "@opencode/client/service"
import { WorktreeFailure } from "../utils/errors.ts"
import type { ManagedWorktree, WorktreeCreateRequest, WorktreeTransport } from "./types.ts"

function isLegacyWorktreeError(
  error: unknown,
): error is { data: { message: string; forceRequired?: boolean | null } } {
  if (typeof error !== "object" || error === null) return false
  const candidate = error as { name?: unknown; data?: { message?: unknown } }
  return candidate.name === "WorktreeError" && typeof candidate.data?.message === "string"
}

function isOperationError(error: unknown): error is { message: string; forceRequired?: boolean | null } {
  if (typeof error !== "object" || error === null) return false
  const candidate = error as { _tag?: unknown; message?: unknown }
  return candidate._tag === "Worktree.OperationError" && typeof candidate.message === "string"
}

/** Normalize any thrown value from the generated client into a `WorktreeFailure`. */
export function normalizeTransportError(error: unknown): WorktreeFailure {
  if (error instanceof WorktreeFailure) return error
  if (isWorktreeError(error) || isLegacyWorktreeError(error)) {
    // HTTP WorktreeError: { _tag?, name: "WorktreeError", data: { message, forceRequired? } }
    return new WorktreeFailure({
      message: error.data.message,
      forceRequired: error.data.forceRequired ?? undefined,
      nativeName: "WorktreeError",
    })
  }
  if (isOperationError(error)) {
    // In-process domain error: { _tag: "Worktree.OperationError", message, forceRequired? }
    return new WorktreeFailure({
      message: error.message,
      forceRequired: error.forceRequired ?? undefined,
      nativeName: "WorktreeError",
    })
  }
  if (error instanceof Error) {
    const cause = (error as { cause?: { status?: number } }).cause
    const status = (error as { status?: number }).status ?? cause?.status
    const reason = (error as { reason?: string }).reason
    if (reason === "UnexpectedStatus" && typeof status === "number") {
      return new WorktreeFailure({ message: `OpenCode API request failed with HTTP ${status}.`, nativeName: error.name })
    }
    if (reason === "Transport") {
      return new WorktreeFailure({
        message: `Could not reach the OpenCode service: ${error.message}`,
        nativeName: error.name,
      })
    }
    return new WorktreeFailure({ message: error.message, nativeName: error.name })
  }
  return new WorktreeFailure({ message: String(error) })
}

export class WorktreeGateway implements WorktreeTransport {
  private clientPromise?: Promise<ReturnType<typeof OpenCode.make>>

  constructor(private readonly options: {
    project: { id: string }
    worktree?: WorktreeApi
    serverUrl?: string
  }) {}

  private async api(projectID: string): Promise<WorktreeApi> {
    if (projectID !== this.options.project.id) {
      throw new WorktreeFailure({ message: `Worktree access requested for an unknown project: ${projectID}.` })
    }
    if (!this.options.serverUrl && this.options.worktree) return this.options.worktree
    return (await this.client()).worktree
  }

  /** Lazily create (once) the generated OpenCode client used for all native calls. */
  private client(): Promise<ReturnType<typeof OpenCode.make>> {
    this.clientPromise ??= (async () => {
      if (this.options.serverUrl) {
        return OpenCode.make({ baseUrl: this.options.serverUrl })
      }
      const endpoint = await Service.discover()
      if (!endpoint) {
        throw new WorktreeFailure({
          message:
            "Could not discover the local OpenCode service required for managed worktrees. " +
            'Set the "serverUrl" plugin option to the OpenCode server URL to connect explicitly.',
        })
      }
      return OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
    })()
    // Do not cache rejected promises: a transient discovery failure should be retryable.
    this.clientPromise.catch(() => {
      this.clientPromise = undefined
    })
    return this.clientPromise
  }

  async list(input: { projectID: string }): Promise<readonly ManagedWorktree[]> {
    try {
      const worktree = await this.api(input.projectID)
      const directories = await worktree.list({ projectID: input.projectID })
      return (directories ?? []).map((entry) => ({ directory: entry.directory, strategy: entry.strategy }))
    } catch (error) {
      throw normalizeTransportError(error)
    }
  }

  async create(input: WorktreeCreateRequest): Promise<{ directory: string }> {
    try {
      const worktree = await this.api(input.projectID)
      // `directory` = parent dir, `name` = leaf, `branch` = existing ref for the
      // detached checkout; the response's `directory` is the actual worktree path.
      const result = await worktree.create({
        projectID: input.projectID,
        directory: input.directory,
        name: input.name,
        ...(input.baseRef === undefined ? {} : { branch: input.baseRef }),
      })
      return { directory: result.directory }
    } catch (error) {
      throw normalizeTransportError(error)
    }
  }

  async remove(input: { projectID: string; directory: string; force: boolean }): Promise<void> {
    try {
      const worktree = await this.api(input.projectID)
      await worktree.remove({ projectID: input.projectID, directory: input.directory, force: input.force })
    } catch (error) {
      throw normalizeTransportError(error)
    }
  }

  async refresh(input: { projectID: string }): Promise<void> {
    try {
      const worktree = await this.api(input.projectID)
      await worktree.refresh({ projectID: input.projectID })
    } catch (error) {
      throw normalizeTransportError(error)
    }
  }
}
