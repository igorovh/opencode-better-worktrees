/**
 * Bridge to OpenCode's native Worktree API (`v2.worktree.*`).
 *
 * Why a bridge at all: the V2 plugin context does not expose a `worktree`
 * domain (verified against `@opencode-ai/plugin@beta` type definitions), while
 * the official generated client (`@opencode-ai/client`) does. This module is
 * the single place that knows how to reach those routes:
 *
 *   1. an explicit `serverUrl` plugin option wins;
 *   2. otherwise the shared local OpenCode service is discovered through the
 *      official `Service.discover()` API (read-only: it never starts or stops
 *      any process).
 *
 * All worktree lifecycle management goes through the native API. This module
 * never shells out to `git worktree`.
 */

import { isWorktreeError, OpenCode } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/service"
import { WorktreeFailure } from "../utils/errors.ts"
import type { ManagedWorktree, WorktreeTransport } from "./types.ts"

/** Normalize any thrown value from the generated client into a `WorktreeFailure`. */
export function normalizeTransportError(error: unknown): WorktreeFailure {
  if (isWorktreeError(error)) {
    // Native WorktreeError: { name: "WorktreeError", data: { message, forceRequired? } }
    return new WorktreeFailure({
      message: error.data.message,
      forceRequired: error.data.forceRequired ?? undefined,
      nativeName: error.name,
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

  constructor(private readonly options: { serverUrl?: string }) {}

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
      const client = await this.client()
      const directories = await client.worktree.list({ projectID: input.projectID })
      return (directories ?? []).map((entry) => ({ directory: entry.directory, strategy: entry.strategy }))
    } catch (error) {
      throw normalizeTransportError(error)
    }
  }

  async create(input: {
    projectID: string
    strategy: string
    directory: string
    from?: string
    branch?: string
    name?: string
  }): Promise<{ directory: string }> {
    try {
      const client = await this.client()
      // The native request shape: { strategy, directory, from?, branch?, name? } (additionalProperties: false)
      const info = await client.worktree.create({
        projectID: input.projectID,
        strategy: input.strategy,
        directory: input.directory,
        from: input.from,
        branch: input.branch,
        name: input.name,
      })
      return { directory: info.directory }
    } catch (error) {
      throw normalizeTransportError(error)
    }
  }

  async remove(input: { projectID: string; directory: string; force: boolean }): Promise<void> {
    try {
      const client = await this.client()
      await client.worktree.remove({ projectID: input.projectID, directory: input.directory, force: input.force })
    } catch (error) {
      throw normalizeTransportError(error)
    }
  }

  async refresh(input: { projectID: string }): Promise<void> {
    try {
      const client = await this.client()
      await client.worktree.refresh({ projectID: input.projectID })
    } catch (error) {
      throw normalizeTransportError(error)
    }
  }
}
