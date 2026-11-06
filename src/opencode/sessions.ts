import type { Plugin } from "@opencode/plugin"
import type { SessionsLike } from "./types.ts"

type PluginContext = Parameters<typeof Plugin.define>[0]["setup"] extends (ctx: infer C) => unknown ? C : never
type SessionDomain = PluginContext["session"]

export function contextSessions(session: SessionDomain): SessionsLike {
  return {
    async get(sessionID) {
      const info = await session.get({ sessionID })
      return { id: info.id, projectID: info.projectID, directory: info.location.directory }
    },

    // A pointer move: files stay where they are.
    async move(sessionID, directory) {
      await session.move({ sessionID, directory })
    },
  }
}
