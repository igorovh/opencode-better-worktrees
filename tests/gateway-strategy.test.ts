import { describe, expect, test } from "bun:test"
import { createWithStrategyFallback, strategyCandidates } from "../src/opencode/gateway.ts"
import { WorktreeFailure } from "../src/utils/errors.ts"

describe("strategyCandidates", () => {
  test("orders cached winner, configured value, then aliases without duplicates", () => {
    expect(strategyCandidates("git")).toEqual(["git", "git_worktree"])
    expect(strategyCandidates("git_worktree")).toEqual(["git_worktree", "git"])
    expect(strategyCandidates("git", "git_worktree")).toEqual(["git_worktree", "git"])
    expect(strategyCandidates("git", "git")).toEqual(["git", "git_worktree"])
    expect(strategyCandidates("custom", undefined)).toEqual(["custom", "git", "git_worktree"])
  })
})

describe("createWithStrategyFallback", () => {
  test("succeeds on the first candidate when the server accepts it", async () => {
    const seen: string[] = []
    const result = await createWithStrategyFallback(
      async (strategy) => {
        seen.push(strategy)
        return { directory: "/wt/x" }
      },
      "git",
    )
    expect(result).toEqual({ directory: "/wt/x", strategy: "git" })
    expect(seen).toEqual(["git"])
  })

  test("retries the alias only on the native strategy-unavailable failure", async () => {
    const seen: string[] = []
    const result = await createWithStrategyFallback(
      async (strategy) => {
        seen.push(strategy)
        if (strategy === "git") {
          throw new WorktreeFailure({ message: "Worktree strategy unavailable: git", nativeName: "WorktreeError" })
        }
        return { directory: "/wt/y" }
      },
      "git",
    )
    expect(result.strategy).toBe("git_worktree")
    expect(seen).toEqual(["git", "git_worktree"])
  })

  test("gives up after all candidates and rethrows the last failure", async () => {
    const seen: string[] = []
    const attempt = async (strategy: string) => {
      seen.push(strategy)
      throw new WorktreeFailure({ message: `Worktree strategy unavailable: ${strategy}` })
    }
    await expect(createWithStrategyFallback(attempt, "git")).rejects.toThrow("Worktree strategy unavailable: git_worktree")
    expect(seen).toEqual(["git", "git_worktree"])
  })

  test("unrelated failures surface immediately without alias retries", async () => {
    const seen: string[] = []
    const attempt = async (strategy: string) => {
      seen.push(strategy)
      throw new WorktreeFailure({ message: "Worktree destination already exists: /wt/z" })
    }
    await expect(createWithStrategyFallback(attempt, "git")).rejects.toThrow("already exists")
    expect(seen).toEqual(["git"])
  })
})
