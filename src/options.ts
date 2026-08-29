/**
 * Plugin options (from `opencode.jsonc` → `plugins[].options`) with defaults.
 *
 * Conventions follow OpenCode wherever possible:
 * - `strategy` is the native `Worktree.StrategyID` string forwarded verbatim to
 *   `v2.worktree.create`. The id OpenCode registers has been renamed across
 *   betas (`git` today, `git_worktree` in some builds); the gateway negotiates
 *   automatically, so the value stays configurable without pinning a build.
 * - `directoryRoot` decides where managed worktree directories live. The
 *   native create API requires the caller to supply an absolute directory.
 */

import { isAbsolute, resolve } from "node:path"
import { InvalidInputError } from "./utils/errors.ts"

export interface Options {
  /** Root directory for managed worktrees. Relative paths resolve against the project canonical directory. */
  readonly directoryRoot: string
  /** Prefix applied to the generated branch name when the agent does not pass an explicit branch. */
  readonly branchPrefix: string
  /** Native worktree strategy id forwarded to `v2.worktree.create`. */
  readonly strategy: string
  /** Explicit OpenCode server URL. When empty, the shared local service is discovered automatically. */
  readonly serverUrl?: string
  /** Whether to inject the concise worktree usage policy into agent context. */
  readonly instructions: boolean
}

export const DEFAULT_DIRECTORY_ROOT = "../.opencode-worktrees"
export const DEFAULT_BRANCH_PREFIX = "agent/"
export const DEFAULT_STRATEGY = "git"

function readString(raw: Record<string, unknown>, key: string, fallback: string, what: string): string {
  const value = raw[key]
  if (value === undefined) return fallback
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidInputError(`Plugin option "${key}" must be a non-empty string (${what}).`)
  }
  return value
}

function readOptionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key]
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidInputError(`Plugin option "${key}" must be a non-empty string when provided.`)
  }
  return value
}

function readBoolean(raw: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = raw[key]
  if (value === undefined) return fallback
  if (typeof value !== "boolean") {
    throw new InvalidInputError(`Plugin option "${key}" must be a boolean.`)
  }
  return value
}

export function resolveOptions(raw: unknown): Options {
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    directoryRoot: readString(
      record,
      "directoryRoot",
      DEFAULT_DIRECTORY_ROOT,
      "a path relative to the project root or an absolute path",
    ),
    branchPrefix: readString(record, "branchPrefix", DEFAULT_BRANCH_PREFIX, "a Git branch name prefix"),
    strategy: readString(record, "strategy", DEFAULT_STRATEGY, "an OpenCode native worktree strategy id"),
    serverUrl: readOptionalString(record, "serverUrl"),
    instructions: readBoolean(record, "instructions", true),
  }
}

/**
 * Resolve the absolute worktree root for a project.
 * Relative `directoryRoot` values resolve against the project canonical directory.
 */
export function resolveDirectoryRoot(options: Options, projectCanonicalDirectory: string): string {
  if (isAbsolute(options.directoryRoot)) return resolve(options.directoryRoot)
  return resolve(projectCanonicalDirectory, options.directoryRoot)
}

/** Default branch for a new worktree when the agent does not specify one. */
export function branchFor(options: Options, name: string, explicitBranch?: string): string {
  return explicitBranch ?? `${options.branchPrefix}${name}`
}
