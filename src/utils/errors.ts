/** Failure of a native worktree operation; keeps the native message and `forceRequired` hint. */
export class WorktreeFailure extends Error {
  readonly forceRequired?: boolean
  /** Native error name when known, e.g. "WorktreeError". */
  readonly nativeName?: string

  constructor(input: { message: string; forceRequired?: boolean; nativeName?: string }) {
    super(input.message)
    this.name = "WorktreeFailure"
    this.forceRequired = input.forceRequired
    this.nativeName = input.nativeName
  }
}

/** Invalid plugin options or tool input. */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidInputError"
  }
}

export function isWorktreeFailure(value: unknown): value is WorktreeFailure {
  return value instanceof WorktreeFailure
}

/** Convert `WorktreeFailure` instances and raw native `WorktreeError` bodies into a `WorktreeFailure`. */
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
