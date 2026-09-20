/**
 * Bridge to OpenCode's native Worktree API (`v2.worktree.*`).
 *
 * Uses the plugin's native worktree domain unless an explicit serverUrl is
 * configured. Standalone callers can discover the shared service read-only.
 * Operations are scoped by projectID; location resolves the target install.
 *
 * All worktree lifecycle management goes through the native API. This module
 * never shells out to `git worktree`.
 */

import { isWorktreeError, OpenCode } from "@opencode-ai/client"
import type { WorktreeApi } from "@opencode-ai/client/promise/api"
import { Service } from "@opencode-ai/client/service"
import { WorktreeFailure } from "../utils/errors.ts"
import type { ManagedWorktree, WorktreeCreateRequest, WorktreeTransport } from "./types.ts"

/** Normalize any thrown value from the generated client into a `WorktreeFailure`. */
export function normalizeTransportError(error: unknown): WorktreeFailure {
  if (error instanceof WorktreeFailure) return error
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

/**
 * Native strategy ids across known OpenCode builds. OpenCode registers the
 * git-worktree strategy under an id that has been renamed between betas
 * (`git_worktree` in some builds, `git` in others — verified against the
 * running `0.0.0-beta-18684` server, whose registry only knows `git`). The
 * configured `strategy` option is tried first, then the remaining aliases, so
 * the plugin works on either build without configuration.
 */
const STRATEGY_ALIASES = ["git", "git_worktree"] as const

const STRATEGY_UNAVAILABLE = /strategy unavailable/i

/**
 * Current server builds require `projectID` in in-process worktree inputs;
 * the pinned beta-19157 client types predate it, hence the cast.
 */
function nativeInput<T extends object>(projectID: string, input: T): T {
  return { projectID, ...input } as T
}

/** Candidate strategy ids to attempt, de-duplicated, cached winner first. */
export function strategyCandidates(preferred: string, resolved?: string): string[] {
  return [...new Set([resolved, preferred, ...STRATEGY_ALIASES].filter((id): id is string => typeof id === "string"))]
}

/**
 * Run the native create call trying each candidate strategy id. Only failures
 * explicitly reported by the server as "strategy unavailable: <id>" advance to
 * the next candidate; every other error surfaces immediately. Returns the
 * strategy id the server accepted so callers can cache it.
 */
export async function createWithStrategyFallback(
  attempt: (strategy: string) => Promise<{ directory: string }>,
  preferred: string,
  resolved?: string,
): Promise<{ directory: string; strategy: string }> {
  let lastError: unknown
  for (const strategy of strategyCandidates(preferred, resolved)) {
    try {
      return { ...(await attempt(strategy)), strategy }
    } catch (error) {
      lastError = error
      const failure = error instanceof WorktreeFailure ? error : null
      if (!failure || !STRATEGY_UNAVAILABLE.test(failure.message)) throw error
    }
  }
  throw lastError
}

export class WorktreeGateway implements WorktreeTransport {
  private clientPromise?: Promise<ReturnType<typeof OpenCode.make>>
  /** Strategy id the connected server last accepted for create, if known. */
  private resolvedStrategy?: string

  constructor(private readonly options: {
    project: { id: string; directory: string }
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
      const directories = await worktree.list(
        nativeInput(input.projectID, { location: { directory: this.options.project.directory } }),
      )
      return (directories ?? []).map((entry) => ({ directory: entry.directory, strategy: entry.strategy }))
    } catch (error) {
      throw normalizeTransportError(error)
    }
  }

  async create(input: WorktreeCreateRequest): Promise<{ directory: string }> {
    try {
      const worktree = await this.api(input.projectID)
      // Verified native contract: `directory` = parent dir, `name` = leaf,
      // `branch` = existing ref for the detached checkout; the response's
      // `directory` is the actual worktree path.
      const result = await createWithStrategyFallback(
        (strategy) =>
          worktree
            .create(
              nativeInput(input.projectID, {
                location: { directory: this.options.project.directory },
                strategy,
                directory: input.directory,
                name: input.name,
                // The in-process worktree domain requires a string; the HTTP
                // layer defaults an omitted branch to the server's HEAD.
                branch: input.baseRef ?? "HEAD",
              }),
            )
            .catch((error: unknown) => {
              throw normalizeTransportError(error)
            }),
        input.strategy,
        this.resolvedStrategy,
      )
      this.resolvedStrategy = result.strategy
      return { directory: result.directory }
    } catch (error) {
      throw normalizeTransportError(error)
    }
  }

  async remove(input: { projectID: string; directory: string; force: boolean }): Promise<void> {
    try {
      const worktree = await this.api(input.projectID)
      await worktree.remove(
        nativeInput(input.projectID, {
          location: { directory: this.options.project.directory },
          directory: input.directory,
          force: input.force,
        }),
      )
    } catch (error) {
      throw normalizeTransportError(error)
    }
  }

  async refresh(input: { projectID: string }): Promise<void> {
    try {
      const worktree = await this.api(input.projectID)
      await worktree.refresh(nativeInput(input.projectID, { location: { directory: this.options.project.directory } }))
    } catch (error) {
      throw normalizeTransportError(error)
    }
  }
}
