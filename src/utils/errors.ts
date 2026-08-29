/**
 * Error types used across the plugin.
 *
 * Everything the agent should be able to react to is reported as a structured
 * tool result. `WorktreeFailure` is the single wrapper used for failures of the
 * native OpenCode Worktree API so that native messages (including the
 * `forceRequired` hint from `WorktreeError`) survive normalization.
 */

export class WorktreeFailure extends Error {
  /** Native `WorktreeError.data.forceRequired`, when the server reported it. */
  readonly forceRequired?: boolean
  /** The `name` of the native error, when known (e.g. "WorktreeError"). */
  readonly nativeName?: string

  constructor(input: { message: string; forceRequired?: boolean; nativeName?: string }) {
    super(input.message)
    this.name = "WorktreeFailure"
    this.forceRequired = input.forceRequired
    this.nativeName = input.nativeName
  }
}

/** Raised when plugin options or tool input are invalid. */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidInputError"
  }
}

export function isWorktreeFailure(value: unknown): value is WorktreeFailure {
  return value instanceof WorktreeFailure
}

/**
 * Convert anything thrown around worktree operations into a `WorktreeFailure`.
 *
 * Accepts both `WorktreeFailure` instances and raw native `WorktreeError`
 * bodies (`{ name: "WorktreeError", data: { message, forceRequired? } }`),
 * which is the shape the generated client throws for declared 400 responses.
 */
export function toWorktreeFailure(error: unknown): WorktreeFailure {
  if (error instanceof WorktreeFailure) return error
  const shape = error as { name?: string; data?: { message?: string; forceRequired?: boolean | null } } | null
  if (typeof shape === "object" && shape !== null && shape.name === "WorktreeError") {
    return new WorktreeFailure({
      message: shape.data?.message ?? "The OpenCode Worktree API reported an error.",
      forceRequired: shape.data?.forceRequired ?? undefined,
      nativeName: "WorktreeError",
    })
  }
  if (error instanceof Error) return new WorktreeFailure({ message: error.message })
  return new WorktreeFailure({ message: String(error) })
}
