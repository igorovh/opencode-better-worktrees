import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { branchFor, DEFAULT_BRANCH_PREFIX, resolveDirectoryRoot, resolveOptions } from "../src/options.ts"
import { InvalidInputError } from "../src/utils/errors.ts"

describe("plugin options", () => {
  test("defaults let OpenCode pick the worktree location", () => {
    const options = resolveOptions({})
    expect(options.directoryRoot).toBeUndefined()
    expect(resolveDirectoryRoot(options, "/repo")).toBeUndefined()
    expect(options.branchPrefix).toBe(DEFAULT_BRANCH_PREFIX)
    expect(options.instructions).toBe(true)
  })

  test("non-object input falls back to defaults", () => {
    for (const raw of [undefined, null, 42, "x"]) {
      expect(resolveOptions(raw)).toEqual({ directoryRoot: undefined, branchPrefix: DEFAULT_BRANCH_PREFIX, instructions: true })
    }
  })

  test("reads all documented options", () => {
    expect(resolveOptions({ directoryRoot: "/tmp/wt", branchPrefix: "wt/", instructions: false })).toEqual({
      directoryRoot: "/tmp/wt",
      branchPrefix: "wt/",
      instructions: false,
    })
  })

  test("rejects wrong types instead of silently coercing", () => {
    expect(() => resolveOptions({ branchPrefix: 7 })).toThrow(InvalidInputError)
    expect(() => resolveOptions({ instructions: "yes" })).toThrow(InvalidInputError)
    expect(() => resolveOptions({ directoryRoot: "" })).toThrow(InvalidInputError)
  })

  test("rejects a branch prefix that would produce an unsafe ref", () => {
    for (const bad of ["-x/", "a b/", "a;rm/", "../", "$(id)/"]) {
      expect(() => resolveOptions({ branchPrefix: bad })).toThrow(InvalidInputError)
    }
  })

  test("a relative directoryRoot resolves against the project canonical directory", () => {
    const options = resolveOptions({ directoryRoot: "../.worktrees" })
    expect(resolveDirectoryRoot(options, resolve("/work/repo"))).toBe(resolve("/work/.worktrees"))
  })

  test("branchFor applies the prefix unless an explicit branch is given", () => {
    const options = resolveOptions({ branchPrefix: "agent/" })
    expect(branchFor(options, "auth")).toBe("agent/auth")
    expect(branchFor(options, "auth", "hotfix/x")).toBe("hotfix/x")
  })
})
