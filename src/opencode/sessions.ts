/**
 * Session operations backed by the plugin context's native session domain.
 *
 * The plugin context (`ctx.session`) already exposes exactly what we need:
 * create (with a location), get, move, prompt, and wait. This wrapper only
 * narrows the shapes — no reimplementation.
 */

import type { Plugin } from "@opencode-ai/plugin"
import type { SessionsLike, SessionSnapshot } from "./types.ts"

type PluginContext = Parameters<typeof Plugin.define>[0]["setup"] extends (ctx: infer C) => unknown ? C : never
type SessionDomain = PluginContext["session"]

function snapshot(info: Awaited<ReturnType<SessionDomain["get"]>>): SessionSnapshot {
  return {
    id: info.id,
    projectID: info.projectID,
    directory: info.location.directory,
    title: info.title,
  }
}

export function contextSessions(session: SessionDomain): SessionsLike {
  return {
    async get(sessionID) {
      return snapshot(await session.get({ sessionID }))
    },

    async createAtLocation(input) {
      // Native session creation supports a `location`, which is what gives a
      // spawned agent a real worktree location (no `cd` hacks anywhere).
      const created = await session.create({
        title: input.title,
        agent: input.agent,
        model: input.model ? { providerID: input.model.providerID, id: input.model.id } : undefined,
        location: { directory: input.directory },
      })
      return snapshot(created)
    },

    async move(sessionID, directory) {
      await session.move({ sessionID, directory })
    },

    async prompt(sessionID, text) {
      await session.prompt({ sessionID, text })
    },

    async wait(sessionID) {
      await session.wait({ sessionID })
    },
  }
}
