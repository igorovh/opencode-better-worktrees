/**
 * opencode2-worktrees — agent-managed Git worktrees for OpenCode 2.
 *
 * Lets the AI agent create, switch between, inspect, delegate work to, and
 * remove OpenCode-managed Git worktrees. All worktree lifecycle management
 * goes through OpenCode's native V2 Worktree API; the plugin is a thin
 * orchestration layer and never runs `git worktree` itself.
 *
 * Plugin ID: "agent-worktrees".
 */

import { Plugin } from "@opencode-ai/plugin"
import { WorktreeGateway } from "./opencode/gateway.ts"
import { contextSessions } from "./opencode/sessions.ts"
import { contextVcs } from "./opencode/vcs.ts"
import { resolveOptions } from "./options.ts"
import { KeyedMutex } from "./utils/mutex.ts"
import { exists } from "./utils/fs.ts"
import { buildTools, registerTools } from "./tools/registry.ts"
import { INSTRUCTIONS_TEXT } from "./instructions.ts"

export default Plugin.define({
  id: "agent-worktrees",

  async setup(ctx) {
    const options = resolveOptions(ctx.options)
    const project = {
      id: ctx.location.project.id,
      directory: ctx.location.project.directory,
      canonical: ctx.location.project.canonical,
    }

    // Native plugin domains share this session's server and location.
    const deps = {
      project,
      worktrees: new WorktreeGateway({
        project: { id: project.id, directory: ctx.location.directory },
        worktree: ctx.worktree,
        serverUrl: options.serverUrl,
      }),
      sessions: contextSessions(ctx.session),
      vcs: contextVcs(ctx.vcs),
      fs: { exists },
      agents: {
        get: async (agentID: string) => ctx.agent.get({ agentID }),
      },
      options,
      locks: new KeyedMutex(),
    }

    await registerTools((transform) => ctx.tool.transform(transform), buildTools(deps))

    // Optionally give every model request a concise worktree usage policy.
    const instructions = options.instructions ? await ctx.session.hook("context", (event) => {
      event.system.push({ type: "text", text: INSTRUCTIONS_TEXT })
    }) : undefined

    return () => instructions?.dispose()
  },
})
