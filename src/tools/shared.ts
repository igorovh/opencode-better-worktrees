/**
 * Shared tool infrastructure: dependency bag, tool definition shape, worktree
 * resolution, and the core create/spawn operations reused by the individual
 * tools and by `worktree_delegate`.
 *
 * There is exactly one implementation of each native operation. Delegation
 * composes them; it never duplicates them.
 */

import type { Options } from "../options.ts"
import { branchFor, resolveDirectoryRoot } from "../options.ts"
import { InvalidInputError, WorktreeFailure, toWorktreeFailure } from "../utils/errors.ts"
import { assertValidWorktreeName, basenameOf, resolveInsideRoot, samePath } from "../utils/paths.ts"
import type { KeyedMutex } from "../utils/mutex.ts"
import type { FileChange, FsLike, ManagedWorktree, SessionsLike, VcsLike, WorktreeTransport } from "../opencode/types.ts"

/** Executor context handed to every tool by OpenCode (subset we rely on). */
export interface ToolExecutionContext {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  progress(update: Record<string, unknown>): Promise<void>
}

/** Structured tool result per the V2 contract (`{ output, content }`). */
export interface ToolTextContent {
  readonly type: "text"
  readonly text: string
}

export interface ToolExecutionResult {
  readonly output?: Record<string, unknown>
  readonly content?: string | readonly ToolTextContent[]
  readonly metadata?: Record<string, unknown>
}

/** A registerable tool definition (shape-compatible with the V2 `tool.transform` draft). */
export interface WorktreeTool {
  readonly name: string
  readonly description: string
  readonly input: Record<string, unknown>
  readonly output?: Record<string, unknown>
  readonly execute: (input: unknown, tool: ToolExecutionContext) => Promise<ToolExecutionResult>
}

/** Everything a tool needs. All I/O is injected, which keeps tools unit-testable. */
export interface ToolDeps {
  readonly project: { id: string; directory: string; canonical: string }
  readonly worktrees: WorktreeTransport
  readonly sessions: SessionsLike
  readonly vcs: VcsLike
  readonly fs: FsLike
  readonly agents: { get(agentID: string): Promise<unknown> }
  readonly options: Options
  readonly locks: KeyedMutex
}

/** Render a compact JSON block appended to human-readable tool output. */
export function withJson(human: string, payload: Record<string, unknown>): ToolTextContent[] {
  return [{ type: "text", text: `${human}\n${JSON.stringify(payload, null, 2)}` }]
}

/**
 * Recursively strip `undefined` values so tool results satisfy the strict
 * JSON validation OpenCode applies to tool `output` values. Optional object
 * keys are dropped instead of becoming `undefined`; `undefined` array items
 * become `null`.
 */
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

/**
 * Finalize a tool definition: expected failures (`WorktreeFailure`,
 * `InvalidInputError`, and raw native `WorktreeError` bodies) become
 * structured results the agent can act on; unexpected errors still throw so
 * OpenCode reports them as tool errors. Successful outputs are pruned to
 * strict JSON (no `undefined` fields) before they reach OpenCode's
 * output-schema validation.
 */
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
  /** Directory basename; matches the `name` the worktree was created with. */
  readonly name: string
}

/**
 * Resolve an agent-facing `worktree` reference (name, directory basename, or
 * absolute directory) against the CURRENT project's native worktree list.
 *
 * This is the ownership boundary of the whole plugin: anything that is not
 * returned by `v2.worktree.list` for this project is unusable here.
 */
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
  readonly branch?: string
  readonly from?: string
  readonly strategy: string
  readonly projectID: string
}

/**
 * Core create operation, shared by `worktree_create` and `worktree_delegate`.
 *
 * - validates the name (single safe path segment, no traversal);
 * - resolves a collision-free directory inside the configured root;
 * - calls the native `v2.worktree.create` (OpenCode runs any configured setup
 *   scripts itself; the plugin never reproduces that lifecycle);
 * - serializes concurrent creates per directory with a keyed mutex.
 */
export async function createWorktree(
  deps: ToolDeps,
  input: { name: string; branch?: string; from?: string },
): Promise<CreateWorktreeResult> {
  const name = assertValidWorktreeName(input.name)
  const root = resolveDirectoryRoot(deps.options, deps.project.canonical)
  const directory = resolveInsideRoot(root, name)
  const branch = branchFor(deps.options, name, input.branch)

  return deps.locks.run(directory.toLowerCase(), async () => {
    const existing = await deps.worktrees.list({ projectID: deps.project.id })

    const duplicate = existing.find((entry) => samePath(entry.directory, directory))
    if (duplicate) {
      throw new WorktreeFailure({
        message: `A managed worktree already exists at "${duplicate.directory}". Pick a different name.`,
      })
    }
    const nameTaken = existing.some((entry) => samePath(basenameOf(entry.directory), name))
    if (nameTaken) {
      throw new WorktreeFailure({
        message: `A managed worktree named "${name}" already exists. Pick a different name.`,
      })
    }

    if (await deps.fs.exists(directory)) {
      throw new WorktreeFailure({
        message:
          `Directory "${directory}" already exists but is not an OpenCode-managed worktree. ` +
          "Refusing to touch it; pick a different worktree name.",
      })
    }

    // Native create: OpenCode owns worktree lifecycle, including setup scripts.
    const created = await deps.worktrees.create({
      projectID: deps.project.id,
      strategy: deps.options.strategy,
      directory,
      branch,
      from: input.from,
      name,
    })

    return {
      created: true as const,
      directory: created.directory ?? directory,
      name,
      branch,
      from: input.from,
      strategy: deps.options.strategy,
      projectID: deps.project.id,
    }
  })
}

export interface SpawnAgentResult {
  readonly sessionID: string
  readonly directory: string
  readonly task: string
  readonly started: true
  readonly waited?: true
}

/**
 * Core spawn operation, shared by `worktree_spawn_agent` and
 * `worktree_delegate`. Creates a real OpenCode session whose location is the
 * worktree, then hands the task to it through the official prompt API.
 */
export async function spawnWorktreeAgent(
  deps: ToolDeps,
  input: { worktree: ResolvedWorktree; task: string; agent?: string; model?: { providerID: string; id: string }; wait?: boolean },
): Promise<SpawnAgentResult> {
  const task = input.task
  if (typeof task !== "string" || task.trim() === "") {
    throw new InvalidInputError('The "task" input is required and must describe the work for the new session.')
  }

  if (input.agent !== undefined) {
    try {
      await deps.agents.get(input.agent)
    } catch {
      throw new WorktreeFailure({
        message: `Agent "${input.agent}" is not available in this project. Omit "agent" to use the default, or check the configured agent name.`,
      })
    }
  }

  const title = task.replaceAll(/\s+/g, " ").trim().slice(0, 60) || `Worktree task: ${input.worktree.name}`
  const session = await deps.sessions.createAtLocation({
    title,
    agent: input.agent,
    model: input.model,
    directory: input.worktree.directory,
  })
  await deps.sessions.prompt(session.id, task)
  if (input.wait) {
    await deps.sessions.wait(session.id)
    return { sessionID: session.id, directory: input.worktree.directory, task, started: true, waited: true }
  }
  return { sessionID: session.id, directory: input.worktree.directory, task, started: true }
}

/** Aggregate a native status list into counters used by status/list outputs. */
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
