/**
 * Static hygiene checks: the plugin must never implement worktree lifecycle
 * itself and must not reference APIs it may not use.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

function collectSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...collectSourceFiles(full))
    else if (full.endsWith(".ts")) out.push(full)
  }
  return out
}

const srcDir = join(import.meta.dir, "..", "src")
const sources = collectSourceFiles(srcDir)
const allCode = sources.map((file) => `// ${file}\n${readFileSync(file, "utf8")}`).join("\n")

describe("plugin hygiene", () => {
  test("src/ never shells out to git worktree lifecycle or destructive git commands", () => {
    // Command-shaped patterns only: prose in descriptions/comments may mention
    // that git worktree must not be used, but no command literals may appear.
    const forbidden = [
      /git\s+worktree\s+(add|remove|prune|list)\b/i,
      /["'`]\s*worktree\s+(add|remove|prune|list)\b/,
      /git\s+reset\s+--hard/i,
      /git\s+clean\b/i,
      /branch\s+-D\b/,
    ]
    for (const pattern of forbidden) {
      expect(allCode.match(pattern)).toBeNull()
    }
  })

  test("no spawn/exec primitives are used for worktree management", () => {
    for (const pattern of [/\bBun\.spawn\b/, /\bchild_process\b/, /\bnode:child_process\b/, /\bexecFileSync\b/, /\bspawnSync\b/]) {
      expect(allCode.match(pattern)).toBeNull()
    }
  })

  test("does not reference server-internal modules or manage the service lifecycle", () => {
    expect(allCode).not.toContain("@opencode/core")
    expect(allCode).not.toContain("Service.ensure")
    expect(allCode).not.toContain("Service.stop")
  })

  test("HTTP client access is confined to the gateway", () => {
    // Only gateway.ts may import the generated client; other modules must use deps.
    for (const file of sources) {
      if (file.replaceAll("\\", "/").endsWith("opencode/gateway.ts")) continue
      const code = readFileSync(file, "utf8")
      expect(code.match(/from "@opencode\/client/g)).toBeNull()
    }
  })
})
