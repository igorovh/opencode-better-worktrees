import type { Options } from "../options.ts"
import { branchFor, resolveDirectoryRoot } from "../options.ts"
import { InvalidInputError, WorktreeFailure, toWorktreeFailure } from "../utils/errors.ts"
import { assertValidWorktreeName, basenameOf, pathKey, resolveInsideRoot, samePath } from "../utils/paths.ts"
import { assertValidRef } from "../utils/refs.ts"
import type { KeyedMutex } from "../utils/mutex.ts"
import type { FileChange, FsLike, ManagedWorktree, SessionsLike, VcsLike, WorktreeTransport } from "../opencode/types.ts"

/** The subset of OpenCode's tool executor context this plugin uses. */
export interface ToolExecutionContext {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  progress(update: Record<string, unknown>): Promise<void>
}

export interface ToolTextContent {
  readonly type: "text"
  readonly text: string
}

export interface ToolExecutionResult {
  readonly output?: Record<string, unknown>
  readonly content?: string | readonly ToolTextContent[]
  readonly metadata?: Record<string, unknown>
}

/** Shape accepted by `ctx.tool.transform` drafts, with plain JSON Schema input. */
export interface WorktreeTool {
  readonly name: string
  readonly description: string
  readonly input: Record<string, unknown>
  readonly output?: Record<string, unknown>
  readonly execute: (input: unknown, tool: ToolExecutionContext) => Promise<ToolExecutionResult>
}

/** All I/O a tool needs, injected so tools stay unit-testable. */
export interface ToolDeps {
  readonly project: { readonly id: string; readonly directory: string; readonly canonical: string }
  readonly worktrees: WorktreeTransport
  readonly sessions: SessionsLike
  readonly vcs: VcsLike
  readonly fs: FsLike
  readonly options: Options
  readonly locks: KeyedMutex
}

export function withJson(human: string, payload: Record<string, unknown>): ToolTextContent[] {
  return [{ type: "text", text: `${human}\n${JSON.stringify(payload, null, 2)}` }]
}

/** Drop `undefined` keys (and null out `undefined` array items): OpenCode validates tool output as strict JSON. */
export function jsonSafe<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : jsonSafe(item))) as unknown as T
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue
      result[key] = jsonSafe(item)
    }
    return result as unknown as T
  }
  return value
}

/** Expected failures become structured results the agent can act on; unexpected errors still throw. */
export function defineTool(tool: WorktreeTool): WorktreeTool {
  return {
    ...tool,
    execute: async (input, context) => {
      try {
        const result = await tool.execute(input, context)
        return {
          ...result,
          output: result.output === undefined ? undefined : jsonSafe(result.output),
          metadata: result.metadata === undefined ? undefined : jsonSafe(result.metadata),
        }
      } catch (error) {
        const failure = toWorktreeFailure(error)
        const isExpected = error instanceof WorktreeFailure || error instanceof InvalidInputError || (error as { name?: string })?.name === "WorktreeError"
        if (!isExpected) throw error
        const output: Record<string, unknown> = jsonSafe({
          ok: false,
          error: failure.nativeName ?? failure.name,
          message: failure.message,
          ...(failure.forceRequired === true ? { forceRequired: true } : {}),
        })
        return { output, content: withJson(`Error: ${failure.message}`, output) }
      }
    },
  }
}

export interface ResolvedWorktree extends ManagedWorktree {
  /** Directory basename; matches the name the worktree was created with. */
  readonly name: string
}

/** Resolve a name or directory against THIS project's native list; anything else is refused. */
export async function resolveWorktree(deps: ToolDeps, reference: string): Promise<ResolvedWorktree> {
  if (typeof reference !== "string" || reference.trim() === "") {
    throw new InvalidInputError('The "worktree" input is required: pass a worktree name or directory.')
  }
  const entries = await deps.worktrees.list({ projectID: deps.project.id })
  const candidates = entries.map((entry) => ({ ...entry, name: basenameOf(entry.directory) }))

  const byDirectory = candidates.find((entry) => samePath(entry.directory, reference))
  if (byDirectory) return byDirectory

  const byName = candidates.filter((entry) => samePath(entry.name, reference))
  if (byName.length === 1) return byName[0]!
  if (byName.length > 1) {
    throw new WorktreeFailure({
      message:
        `Worktree reference "${reference}" is ambiguous; multiple managed worktrees share that name: ` +
        byName.map((entry) => entry.directory).join(", "),
    })
  }

  const names = candidates.map((entry) => entry.name).join(", ") || "(none)"
  throw new WorktreeFailure({
    message:
      `"${reference}" is not a worktree managed by OpenCode for this project. ` +
      "Only worktrees returned by the native Worktree API can be used. " +
      `Managed worktrees: ${names}.`,
  })
}

export interface CreateWorktreeResult {
  readonly created: true
  readonly directory: string
  readonly name: string
  /** Branch the agent should create inside the worktree before committing. */
  readonly branch: string
  readonly from?: string
  /** Native worktrees start in detached HEAD. */
  readonly detached: true
  readonly projectID: string
}

/** Validate input, refuse duplicates, then call the native create (which also runs OpenCode setup scripts). */
export async function createWorktree(
  deps: ToolDeps,
  input: { name: string; branch?: string; from?: string },
): Promise<CreateWorktreeResult> {
  const name = assertValidWorktreeName(input.name)
  const branch = assertValidRef(branchFor(deps.options, name, input.branch), "branch")
  const from = input.from === undefined ? undefined : assertValidRef(input.from, "starting ref", { revision: true })
  const root = resolveDirectoryRoot(deps.options, deps.project.canonical)
  const directory = root === undefined ? undefined : resolveInsideRoot(root, name)

  return deps.locks.run(directory === undefined ? `name:${pathKey(name)}` : pathKey(directory), async () => {
    const existing = await deps.worktrees.list({ projectID: deps.project.id })

    const duplicate = directory === undefined ? undefined : existing.find((entry) => samePath(entry.directory, directory))
    if (duplicate) {
      throw new WorktreeFailure({
        message: `A managed worktree already exists at "${duplicate.directory}". Pick a different name.`,
      })
    }
    if (existing.some((entry) => samePath(basenameOf(entry.directory), name))) {
      throw new WorktreeFailure({
        message: `A managed worktree named "${name}" already exists. Pick a different name.`,
      })
    }
    if (directory !== undefined && (await deps.fs.exists(directory))) {
      throw new WorktreeFailure({
        message:
          `Directory "${directory}" already exists but is not an OpenCode-managed worktree. ` +
          "Refusing to touch it; pick a different worktree name.",
      })
    }

    const created = await deps.worktrees.create({
      projectID: deps.project.id,
      directory: root,
      name,
      baseRef: from,
    })

    return {
      created: true as const,
      directory: created.directory,
      name: basenameOf(created.directory),
      branch,
      from,
      detached: true as const,
      projectID: deps.project.id,
    }
  })
}

export function summarizeChanges(changes: readonly FileChange[]): {
  changes: number
  additions: number
  deletions: number
} {
  return {
    changes: changes.length,
    additions: changes.reduce((sum, change) => sum + change.additions, 0),
    deletions: changes.reduce((sum, change) => sum + change.deletions, 0),
  }
}
