/**
 * Path validation and comparison helpers.
 *
 * The plugin never trusts raw paths from the agent: worktree names are
 * strictly validated, generated directories are containment-checked against
 * the configured root, and directory comparisons are normalized per platform
 * (case-insensitive on Windows).
 */

import { isAbsolute, join, relative, resolve } from "node:path"
import { InvalidInputError } from "./errors.ts"

/**
 * Worktree names must be a single safe path segment:
 * - starts with an alphanumeric character
 * - may contain alphanumerics, dots, underscores, and dashes
 * - 1-64 characters, no separators, no ".."
 */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function isValidWorktreeName(name: unknown): boolean {
  return typeof name === "string" && NAME_PATTERN.test(name)
}

export function assertValidWorktreeName(name: string): string {
  if (typeof name !== "string" || name.length === 0) {
    throw new InvalidInputError("Worktree name is required.")
  }
  if (!isValidWorktreeName(name)) {
    throw new InvalidInputError(
      `Invalid worktree name "${name}". Use 1-64 characters: letters, digits, dots, underscores, or dashes. ` +
        "The name must be a single path segment without slashes or \"..\".",
    )
  }
  return name
}

function normalizeForCompare(path: string): string {
  const resolved = resolve(path)
  // Windows file systems are case-insensitive; normalize case for comparisons only.
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

/** True when both paths point at the same directory on the current platform. */
export function samePath(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b)
}

/**
 * Resolve `name` (a validated single segment) inside `root`, guaranteeing the
 * result stays inside `root`. Defense in depth on top of name validation.
 */
export function resolveInsideRoot(root: string, name: string): string {
  const target = resolve(join(resolve(root), name))
  if (!isInside(root, target)) {
    throw new InvalidInputError(`Resolved worktree directory "${target}" escapes the worktree root "${root}".`)
  }
  return target
}

/** True when `target` is strictly inside `root` (not the root itself). */
export function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}

/** Basename of a directory path, platform-agnostic. */
export function basenameOf(directory: string): string {
  const parts = resolve(directory).split(/[\\/]/)
  return parts[parts.length - 1] ?? ""
}
