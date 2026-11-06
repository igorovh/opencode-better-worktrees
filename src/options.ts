import { isAbsolute, resolve } from "node:path"
import { InvalidInputError } from "./utils/errors.ts"
import { assertValidRef } from "./utils/refs.ts"

export interface Options {
  /** Parent directory for new worktrees; `undefined` lets OpenCode pick its per-project location. */
  readonly directoryRoot?: string
  /** Prefix of the suggested work branch when the agent passes none. */
  readonly branchPrefix: string
  /** Inject the worktree usage policy into agent context. */
  readonly instructions: boolean
}

export const DEFAULT_BRANCH_PREFIX = "agent/"

function readOptionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key]
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidInputError(`Plugin option "${key}" must be a non-empty string.`)
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
  const branchPrefix = readOptionalString(record, "branchPrefix") ?? DEFAULT_BRANCH_PREFIX
  // The prefix alone may end in "/", so validate it with a placeholder leaf.
  assertValidRef(`${branchPrefix}x`, 'plugin option "branchPrefix"')
  return {
    directoryRoot: readOptionalString(record, "directoryRoot"),
    branchPrefix,
    instructions: readBoolean(record, "instructions", true),
  }
}

/** Absolute worktree root, or `undefined` when OpenCode picks the location. Relative roots resolve against the project. */
export function resolveDirectoryRoot(options: Options, projectCanonicalDirectory: string): string | undefined {
  if (options.directoryRoot === undefined) return undefined
  if (isAbsolute(options.directoryRoot)) return resolve(options.directoryRoot)
  return resolve(projectCanonicalDirectory, options.directoryRoot)
}

export function branchFor(options: Options, name: string, explicitBranch?: string): string {
  return explicitBranch ?? `${options.branchPrefix}${name}`
}
