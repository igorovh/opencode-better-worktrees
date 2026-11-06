import { InvalidInputError } from "./errors.ts"

// Subset of `git check-ref-format` with a shell-safe charset: refs reach git and suggested shell commands.
const REF_PATTERN = /^[A-Za-z0-9._/@+-]{1,200}$/
// Starting points may also use revision suffixes such as `HEAD~2` or `main^`.
const REVISION_PATTERN = /^[A-Za-z0-9._/@+~^-]{1,200}$/

export function isValidRef(ref: unknown, options: { revision?: boolean } = {}): ref is string {
  const pattern = options.revision ? REVISION_PATTERN : REF_PATTERN
  if (typeof ref !== "string" || !pattern.test(ref)) return false
  if (ref.startsWith("-") || ref.startsWith("/") || ref.endsWith("/") || ref.endsWith(".")) return false
  if (ref.includes("..") || ref.includes("//") || ref.includes("@{") || ref === "@") return false
  return ref.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock"))
}

export function assertValidRef(ref: string, what: string, options: { revision?: boolean } = {}): string {
  if (!isValidRef(ref, options)) {
    throw new InvalidInputError(
      `Invalid ${what} "${ref}". Use a Git ref name made of letters, digits and . _ / @ + - ` +
        '(no spaces, no leading "-", no "..").',
    )
  }
  return ref
}
