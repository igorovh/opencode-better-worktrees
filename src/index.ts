import { Plugin } from "@opencode/plugin"
import { WorktreeGateway } from "./opencode/gateway.ts"
import { contextSessions } from "./opencode/sessions.ts"
import { contextVcs } from "./opencode/vcs.ts"
import { resolveOptions } from "./options.ts"
import { KeyedMutex } from "./utils/mutex.ts"
import { exists } from "./utils/fs.ts"
import { buildTools, registerTools } from "./tools/registry.ts"
import { INSTRUCTIONS_TEXT } from "./instructions.ts"

export default Plugin.define({
  id: "opencode-better-worktrees",

  async setup(ctx) {
    const options = resolveOptions(ctx.options)
    // Read lazily: the project may only be resolved after setup.
    const project = {
      get id() {
        return ctx.location.project.id
      },
      get directory() {
        return ctx.location.project.directory
      },
      get canonical() {
        return ctx.location.project.canonical
      },
    }

    const deps = {
      project,
      worktrees: new WorktreeGateway({ projectID: () => ctx.location.project.id, worktree: ctx.worktree }),
      sessions: contextSessions(ctx.session),
      vcs: contextVcs(ctx.vcs),
      fs: { exists },
      options,
      locks: new KeyedMutex(),
    }

    await registerTools((transform) => ctx.tool.transform(transform), buildTools(deps))

    const instructions = options.instructions
      ? await ctx.session.hook("context", (event) => {
          event.system.push({ type: "text", text: INSTRUCTIONS_TEXT })
        })
      : undefined

    return () => instructions?.dispose()
  },
})
