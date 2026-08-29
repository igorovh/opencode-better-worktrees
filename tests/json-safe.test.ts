import { describe, expect, test } from "bun:test"
import { defineTool, jsonSafe } from "../src/tools/shared.ts"
import type { ToolExecutionContext } from "../src/tools/shared.ts"
import { nativeWorktreeError } from "./helpers/fakes.ts"

const context: ToolExecutionContext = {
  sessionID: "ses_main",
  agent: "build",
  messageID: "msg_1",
  id: "call_1",
  progress: async () => {},
}

describe("jsonSafe", () => {
  test("drops undefined object keys at any depth", () => {
    const input: Record<string, unknown> = { a: 1, strategy: undefined, nested: { x: undefined, y: "s", deeper: { z: undefined } } }
    const output = jsonSafe(input)
    expect(output).toEqual({ a: 1, nested: { y: "s", deeper: {} } })
    expect(JSON.stringify(output)).not.toContain("undefined")
  })

  test("maps undefined array items to null and keeps other values", () => {
    const input: unknown[] = [1, undefined, "x", { k: undefined, j: 2 }]
    expect(jsonSafe(input)).toEqual([1, null, "x", { j: 2 }])
  })

  test("leaves primitives, null, and empty containers untouched", () => {
    expect(jsonSafe("s")).toBe("s")
    expect(jsonSafe(0)).toBe(0)
    expect(jsonSafe(null)).toBeNull()
    expect(jsonSafe({})).toEqual({})
    expect(jsonSafe([])).toEqual([])
  })
})

describe("defineTool output sanitization", () => {
  test("the exact user scenario: root entry with strategy/branch undefined passes as strict JSON", async () => {
    // Reproduces worktree_list output for a git project: the root entry has no
    // strategy, and non-repo directories have no branch info.
    const tool = defineTool({
      name: "worktree_list",
      description: "probe",
      input: { type: "object" },
      execute: async () => ({
        output: {
          projectID: "prj_x",
          worktrees: [
            { directory: "/repo", name: "repo", kind: "root", strategy: undefined },
            { directory: "/wt/auth", name: "auth", kind: "managed", strategy: "git_worktree", branch: undefined },
          ],
        },
        content: [{ type: "text", text: "probe" }],
        metadata: { note: undefined, ok: true },
      }),
    })

    const result = await tool.execute({}, context)
    const serialized = JSON.stringify(result.output)
    expect(serialized).not.toContain("undefined")
    expect(result.output).toEqual({
      projectID: "prj_x",
      worktrees: [
        { directory: "/repo", name: "repo", kind: "root" },
        { directory: "/wt/auth", name: "auth", kind: "managed", strategy: "git_worktree" },
      ],
    })
    expect(result.metadata).toEqual({ ok: true })
  })

  test("create-style optional fields (from/waited) are pruned", async () => {
    const tool = defineTool({
      name: "probe",
      description: "probe",
      input: { type: "object" },
      execute: async () => ({
        output: { created: true, directory: "/wt/x", name: "x", from: undefined, waited: undefined, strategy: "git_worktree" },
      }),
    })

    const result = await tool.execute({}, context)
    expect(result.output).toEqual({ created: true, directory: "/wt/x", name: "x", strategy: "git_worktree" })
  })

  test("error path stays structured and JSON-safe", async () => {
    const tool = defineTool({
      name: "probe",
      description: "probe",
      input: { type: "object" },
      execute: async () => {
        throw nativeWorktreeError("worktree is dirty", true)
      },
    })

    const result = await tool.execute({}, context)
    expect(result.output).toEqual({
      ok: false,
      error: "WorktreeError",
      message: "worktree is dirty",
      forceRequired: true,
    })
    expect(JSON.stringify(result.output)).not.toContain("undefined")
  })
})
