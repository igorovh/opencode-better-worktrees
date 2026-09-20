# opencode2-worktrees — Agent-Managed Git Worktrees for OpenCode 2

An [OpenCode 2](https://opencode.ai/v2/docs/) plugin that lets the AI agent itself **create, switch
between, inspect, delegate work to, and remove Git worktrees** — through OpenCode's **native V2
Worktree API**. Users never need to run `git worktree` commands.

```text
User:    Implement the authentication refactor in a separate worktree.
Agent:   → worktree_create      (OpenCode-managed isolation)
         → worktree_use         (session actually moves into the worktree)
         → edits files there, runs tests there
         → reports the result

User:    Work on the frontend and backend changes independently in separate worktrees.
Agent:   → worktree_delegate    (frontend worktree + its own agent session)
         → worktree_delegate    (backend worktree + its own agent session)
         → tracks both with worktree_list / worktree_status
         → removes them with worktree_remove when asked and safe
```

## Why the native Worktree API?

OpenCode 2 owns a managed worktree registry per project:

```text
v2.worktree.list     GET    /api/worktree
v2.worktree.create   POST   /api/worktree
v2.worktree.remove   DELETE /api/worktree
v2.worktree.refresh  POST   /api/worktree/refresh
```

OpenCode remains the **source of truth** for managed worktrees: setup scripts, strategy handling
(`git` / `git_worktree` — the id was renamed across betas, the gateway negotiates automatically),
directory bookkeeping, and safety checks stay inside OpenCode. This plugin is a
thin orchestration layer — it **never** runs `git worktree add/remove/prune`, `git reset --hard`,
`git clean`, or `git branch -D` (a test enforces this).

Operations are scoped by `location` (`location[directory]` in HTTP query parameters), not a
`projectID` path segment. The gateway binds them to the plugin's location and checks the internal
project identity before dispatching.

The plugin uses **`ctx.worktree` by default**, so worktree operations run on the same server as the
session, including standalone servers. An explicit `serverUrl` uses the official generated
`@opencode-ai/client` instead. Standalone gateway callers without a native domain can still use
read-only `Service.discover()`; the plugin never starts or stops a service.

**Beta compatibility:** dependencies are pinned to `0.0.0-beta-19157`, matching the tested server
contract. Older clients using `/api/worktree/{projectID}` receive HTTP 404 on location-scoped
servers. Updating dependencies alone is insufficient: callers must pass `location` instead of
`projectID`. Recheck the API and tests when upgrading OpenCode.

## Installation

Tested with OpenCode 2 `opencode2 v0.0.0-beta-19157` and Bun.

**Local plugin directory** — copy this project somewhere (e.g. `<project>/plugins/agent-worktrees`) and
reference it from your `opencode.json(c)`:

```jsonc
// opencode.jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "./plugins/agent-worktrees"
  ]
}
```

**With options:**

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "./plugins/agent-worktrees",
      "options": {
        "directoryRoot": "../.opencode-worktrees", // where managed worktrees live
        "branchPrefix": "agent/",                  // default branch prefix
        "strategy": "git",                         // native strategy id (auto-negotiated if the build differs)
        "instructions": true                       // inject the worktree usage policy into agent context
      }
    }
  ]
}
```

See `example/opencode.jsonc` for a ready-made example. Install dependencies once
(`bun install` in the plugin folder) so `@opencode-ai/plugin` and `@opencode-ai/client` resolve.

## Tools

| Tool | Purpose |
|---|---|
| `worktree_create` | Create an isolated OpenCode-managed worktree. Inputs: `name` (required), `branch?` (suggested work branch), `from?` (existing ref to detach at). The native API creates worktrees in detached HEAD; the output reports the branch to create with `git switch -c` before committing. |
| `worktree_list` | List all managed worktrees of the current project (root + copies). `includeStatus?` adds branch/change info. |
| `worktree_status` | Inspect one worktree: branch, default branch, changed files, +add/−del, clean/dirty, optional diffs. |
| `worktree_use` | Move the **current session** into a worktree via `v2.session.move`. |
| `worktree_spawn_agent` | Start a **new session whose location is the worktree** and assign it a task. `wait?` blocks until it finishes. |
| `worktree_remove` | Remove a managed worktree safely; `force?` only for explicit destructive cleanup. |
| `worktree_refresh` | Reconcile OpenCode's stored worktree state after external changes. |
| `worktree_delegate` | One-step create + spawn-agent (uses the same primitives, no second implementation). |

## How session movement works

`worktree_use` calls the native `v2.session.move` API: the session's **location pointer** changes to
the worktree directory. Subsequent file edits, shell commands, and VCS tools run inside the worktree
through OpenCode's normal tools — there is no `cd WORKTREE &&` fakery and no plugin-side
"active worktree" variable. The session location is the single source of truth.

Move semantics are pointer-only: **files are not transferred or overwritten.** If your current
directory has uncommitted changes, they stay there and the tool result reports them explicitly
(`leftBehind: { directory, changes, additions, deletions }`), so nothing is silently lost.

## How parallel worktree sessions work

`worktree_spawn_agent` / `worktree_delegate` create a real OpenCode session with
`location: { directory: <worktree> }` and hand the task over via the official prompt API
(`v2.session.prompt`). The spawned session is fully independent: its own context, tools, and
working directory. Run several in parallel (leave `wait` off), then watch them with
`worktree_list` / `worktree_status`. Pass `wait: true` to block until a single delegated task
finishes.

## Safety guarantees

- Only worktrees returned by the **current project's** native Worktree API are addressable; anything
  else — external directories, other projects' worktrees, traversal paths (`../`, `..`, separators in
  names) — is rejected with a clear message.
- Worktree names are validated (`1–64` chars, single path segment) and resolved directories are
  containment-checked against the configured root.
- Duplicate names/directories are refused; concurrent creates/removes are serialized per directory
  with an internal mutex.
- The project's **root/canonical directory is never removable**.
- `force` defaults to `false` and is **never escalated automatically**. When OpenCode reports
  `forceRequired` (native `WorktreeError`), the tool surfaces it and instructs the agent to retry
  with force only if the user explicitly requested destructive cleanup.
- Sessions belonging to a different project are refused by `worktree_use`.
- No raw git lifecycle commands anywhere in the plugin (statically tested).

## Example prompts

```text
Implement this feature in a separate worktree.
Create an isolated worktree for the authentication refactor and continue working there.
Create separate worktrees for the frontend and backend tasks and delegate each task to a separate agent.
Show me all active worktrees and their current changes.
Remove the authentication worktree if it is safe to do so.
```

## Configuration reference

| Option | Default | Meaning |
|---|---|---|
| `directoryRoot` | `"../.opencode-worktrees"` | Where managed worktree directories are created. Relative paths resolve against the project's canonical directory; absolute paths are used as-is. |
| `branchPrefix` | `"agent/"` | Prefix for the suggested work branch reported by `worktree_create` (the native API creates detached worktrees; run `git switch -c <branch>` inside before committing). |
| `strategy` | `"git"` | Native `Worktree.StrategyID` forwarded to `v2.worktree.create`. If the connected build registers a different id (e.g. `git_worktree`), the gateway retries the known alias automatically and caches the winner. |
| `serverUrl` | *(native plugin context)* | Optional explicit OpenCode server URL. Omit to use `ctx.worktree` on the session's server, including `--standalone`. |
| `instructions` | `true` | Inject a concise worktree usage policy into agent system context via the `session.context` hook. |

## Limitations (current OpenCode 2 beta)

- Worktree API changes between beta releases require compatible dependencies and gateway inputs.
  The default native domain avoids a separate HTTP connection; explicit-server calls still need
  a compatible generated client.
- Only one native strategy exists; its id was renamed across betas (`git` today, `git_worktree`
  in other builds). The gateway tries the configured value first, then the known alias, and caches
  whichever the connected server accepts.
- Commit/merge/push of worktree changes is out of scope: OpenCode's native worktree API covers
  lifecycle (create/list/remove/refresh), not Git history manipulation. Use the session's normal
  git tooling for that; keep it isolated from this plugin's lifecycle layer.
- `worktree_use` on a dirty directory moves the session and reports the left-behind changes rather
  than refusing (pointer move cannot destroy them). This is verified against the current beta and
  documented in `src/tools/use.ts`.

## Development

```sh
bun install        # dependencies
bun test           # unit + HTTP contract + real-git integration tests
bun run typecheck  # tsc --noEmit
```

Project layout:

```text
src/
  index.ts            # plugin definition (id: "agent-worktrees")
  options.ts          # option parsing + directory/branch resolution
  instructions.ts     # agent usage policy injected into context
  opencode/           # OpenCode API layer (single place to adapt to beta changes)
    gateway.ts        #   native worktree domain + optional generated HTTP client
    sessions.ts       #   ctx.session wrapper (create at location, move, prompt, wait)
    vcs.ts            #   location-scoped ctx.vcs wrapper
    types.ts          #   transport interfaces (injected → fakes in tests)
  tools/              # one file per agent tool + shared orchestration
  utils/              # name/path validation, errors, keyed mutex, fs probe
tests/                # bun test suite (unit fakes + real-git integration + hygiene)
example/opencode.jsonc
```

To develop against your live OpenCode: point `plugins` at this project's directory, restart
the service with `opencode2 service restart`, and try the example prompts. Restart after changing
unwatched local plugin dependencies. Check `~/.local/share/opencode/log/opencode.log`
(`role=server`) if tools do not appear.
