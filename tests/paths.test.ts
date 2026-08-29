import { describe, expect, test } from "bun:test"
import { resolve, sep } from "node:path"
import {
  assertValidWorktreeName,
  basenameOf,
  isInside,
  isValidWorktreeName,
  resolveInsideRoot,
  samePath,
} from "../src/utils/paths.ts"
import { InvalidInputError } from "../src/utils/errors.ts"

describe("worktree name validation", () => {
  test("accepts safe single-segment names", () => {
    for (const good of ["auth", "auth-refactor", "feature_2", "v1.2", "A1", "x".repeat(64)]) {
      expect(isValidWorktreeName(good)).toBe(true)
    }
  })

  test("rejects traversal, separators, and unsafe segments", () => {
    for (const bad of ["", "..", ".", "../escape", "a/b", "a\\b", ".hidden", "-lead", "a b", "x".repeat(65), null, undefined]) {
      expect(isValidWorktreeName(bad as string)).toBe(false)
    }
  })

  test("assertValidWorktreeName throws a descriptive InvalidInputError", () => {
    expect(() => assertValidWorktreeName("../escape")).toThrow(InvalidInputError)
    expect(() => assertValidWorktreeName("")).toThrow(InvalidInputError)
    expect(assertValidWorktreeName("ok-name")).toBe("ok-name")
  })
})

describe("path containment and comparison", () => {
  const root = resolve("/repo/.opencode-worktrees")

  test("resolveInsideRoot keeps names inside the root", () => {
    expect(resolveInsideRoot(root, "auth")).toBe(resolve(root, "auth"))
  })

  test("resolveInsideRoot refuses escapes (defense in depth behind name validation)", () => {
    // Bypass the name validator to prove the containment check holds on its own.
    const joined = resolve(root, "..", "escape")
    expect(isInside(root, joined)).toBe(false)
    expect(() => resolveInsideRoot(root, "../escape")).toThrow(InvalidInputError)
  })

  test("isInside is false for the root itself and unrelated paths", () => {
    expect(isInside(root, root)).toBe(false)
    expect(isInside(root, resolve("/somewhere/else"))).toBe(false)
  })

  test("samePath is separator- and trailing-slash tolerant", () => {
    expect(samePath(resolve("/repo/auth"), resolve("/repo", "auth"))).toBe(true)
    expect(samePath(resolve("/repo/auth") + sep, resolve("/repo/auth"))).toBe(true)
    expect(samePath(resolve("/repo/auth"), resolve("/repo/other"))).toBe(false)
  })

  test("basenameOf works with both separators", () => {
    expect(basenameOf(resolve("/repo/auth"))).toBe("auth")
    expect(basenameOf("C:\\repo\\auth")).toBe("auth")
  })
})
