import { describe, expect, test } from "bun:test"
import { branchFor, DEFAULT_BRANCH_PREFIX, DEFAULT_DIRECTORY_ROOT, resolveDirectoryRoot, resolveOptions } from "../src/options.ts"
import { InvalidInputError } from "../src/utils/errors.ts"

describe("plugin options", () => {
  test("defaults follow OpenCode conventions", () => {
    const options = resolveOptions({})
    expect(options.directoryRoot).toBe(DEFAULT_DIRECTORY_ROOT)
    expect(options.branchPrefix).toBe(DEFAULT_BRANCH_PREFIX)
    expect(options.instructions).toBe(true)
    expect(options.serverUrl).toBeUndefined()
  })

  test("non-object input falls back to defaults", () => {
    for (const raw of [undefined, null, 42, "x"]) {
      expect(resolveOptions(raw).directoryRoot).toBe(DEFAULT_DIRECTORY_ROOT)
    }
  })

  test("reads all documented options", () => {
    const options = resolveOptions({
      directoryRoot: "/tmp/wt",
      branchPrefix: "wt/",
      serverUrl: "http://127.0.0.1:4096",
      instructions: false,
    })
    expect(options).toEqual({
      directoryRoot: "/tmp/wt",
      branchPrefix: "wt/",
      serverUrl: "http://127.0.0.1:4096",
      instructions: false,
    })
  })

  test("rejects wrong types instead of silently coercing", () => {
    expect(() => resolveOptions({ branchPrefix: 7 })).toThrow(InvalidInputError)
    expect(() => resolveOptions({ instructions: "yes" })).toThrow(InvalidInputError)
    expect(() => resolveOptions({ serverUrl: "" })).toThrow(InvalidInputError)
  })

  test("directoryRoot resolves relative to the project canonical directory", () => {
    const options = resolveOptions({ directoryRoot: "../.opencode-worktrees" })
    const root = resolveDirectoryRoot(options, "/repo")
    expect(root).not.toContain("..")
    expect(root.endsWith(".opencode-worktrees")).toBe(true)
  })

  test("branchFor applies the prefix unless an explicit branch is given", () => {
    const options = resolveOptions({ branchPrefix: "agent/" })
    expect(branchFor(options, "auth")).toBe("agent/auth")
    expect(branchFor(options, "auth", "hotfix/x")).toBe("hotfix/x")
  })
})
