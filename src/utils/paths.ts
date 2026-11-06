import { isAbsolute, join, relative, resolve } from "node:path"
import { InvalidInputError } from "./errors.ts"

/** A single safe path segment: 1-64 chars, starts alphanumeric, no separators or "..". */
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

// Default Windows and macOS file systems ignore case; Linux does not.
const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin"

/** Comparison and lock key for a path on the current platform. */
export function pathKey(path: string): string {
  const resolved = resolve(path)
  return CASE_INSENSITIVE ? resolved.toLowerCase() : resolved
}

export function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b)
}

/** Resolve a validated `name` inside `root`; re-checks containment as defense in depth. */
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

export function basenameOf(directory: string): string {
  const parts = resolve(directory).split(/[\\/]/)
  return parts[parts.length - 1] ?? ""
}
