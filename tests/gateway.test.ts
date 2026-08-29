import { describe, expect, test } from "bun:test"
import { WorktreeGateway, normalizeTransportError } from "../src/opencode/gateway.ts"
import { WorktreeFailure, isWorktreeFailure } from "../src/utils/errors.ts"
import { nativeWorktreeError } from "./helpers/fakes.ts"

describe("gateway error normalization", () => {
  test("native WorktreeError bodies become WorktreeFailure with forceRequired", () => {
    const failure = normalizeTransportError(nativeWorktreeError("worktree is dirty", true))
    expect(isWorktreeFailure(failure)).toBe(true)
    expect(failure.message).toBe("worktree is dirty")
    expect(failure.forceRequired).toBe(true)
  })

  test("forceRequired=null native hint maps to undefined, not true", () => {
    const failure = normalizeTransportError({ name: "WorktreeError", data: { message: "locked", forceRequired: null } })
    expect(failure.forceRequired).toBeUndefined()
  })

  test("generic errors keep their message", () => {
    const failure = normalizeTransportError(new Error("boom"))
    expect(failure.message).toBe("boom")
  })

  test("non-error throwables are stringified", () => {
    expect(normalizeTransportError("plain string").message).toBe("plain string")
  })
})

describe("WorktreeGateway", () => {
  test("explicit serverUrl is honored and transport failures are normalized deterministically", async () => {
    // Port 9 (discard) with nothing listening: deterministic transport failure.
    const gateway = new WorktreeGateway({ serverUrl: "http://127.0.0.1:9" })
    const error = await gateway.list({ projectID: "prj_x" }).then(
      () => null,
      (e) => e,
    )
    expect(error).toBeInstanceOf(WorktreeFailure)
    expect((error as WorktreeFailure).message).toContain("OpenCode")
  })
})
