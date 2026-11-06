# opencode-better-worktrees

A plugin for [OpenCode](https://opencode.ai) (v2) that lets the agent create, list, inspect, switch to and safely
remove Git worktrees. Every change goes through OpenCode's native Worktree API, so OpenCode's setup scripts,
strategy and bookkeeping stay in charge, and the plugin never runs `git worktree` itself.

> Supports OpenCode V2 only, version 2.2.5 or newer. V1 is not supported.

<p align="center">
  <img src="docs/demo.gif" alt="The agent creates a worktree from HEAD~1 and lists the project's worktrees" width="1000">
</p>

The demo shows the agent creating an `auth-refactor` worktree from `HEAD~1` with `worktree_create`, listing the
project's worktrees, and `git worktree list` confirming the new detached checkout.

```text
You:    Implement the authentication refactor in a separate worktree.
Agent:  → worktree_create  { name: "auth-refactor" }
        → worktree_use     { worktree: "auth-refactor" }   (the session moves into the worktree)
        → edits files and runs tests there
        → git switch -c agent/auth-refactor && git commit ...

You:    Show me all worktrees and what changed in them.
Agent:  → worktree_list    { includeStatus: true }
```

## Features

- **Six agent tools**, listed in the [Tools](#tools) table below.
- **Safe by default.**
  - Only worktrees that OpenCode manages for the current project can be used or removed.
  - The project's main directory can never be removed.
  - `force` is never turned on automatically. When OpenCode says a worktree is dirty, the agent has to ask you.
  - Names, branch names and starting refs are validated, so nothing unsafe reaches Git or a suggested shell
    command.
- **Real session moves.** `worktree_use` moves the session's location with OpenCode's session API, so file edits,
  shell commands and VCS tools run inside the worktree. Uncommitted changes you leave behind are reported, never
  moved or deleted.
- **A short usage policy** for the model: when to create a worktree, and to create a branch before committing.
  You can turn it off.

### How it differs from OpenCode's built-in worktree tools

OpenCode 2.2.5 also ships basic `worktree_create`, `worktree_list` and `worktree_remove` tools. This plugin adds:
- a starting ref and a suggested work branch;
- worktrees addressed by name;
- per-project ownership checks and root protection;
- status and diffs;
- moving the session into a worktree;
- refreshing OpenCode's worktree list.

## Requirements

- OpenCode 2.2.5 or newer.
- Git, in a project that is a Git repository.

## Install

Install the plugin from GitHub with the OpenCode CLI. Pin a release tag: you get a stable cached copy, and OpenCode
can tell when a newer tag exists.

```sh
opencode plugin add github:igorovh/opencode-better-worktrees#v0.2.0
```

This adds the plugin to the `plugins` array in `~/.config/opencode/opencode.jsonc`. Restart OpenCode and the
`worktree_*` tools are available to the agent.

You can also add the entry to the config yourself:

```jsonc
{
  "plugins": ["github:igorovh/opencode-better-worktrees#v0.2.0"]
}
```

## Options

Options are read only from the plugin entry in `opencode.jsonc`. `opencode plugin add` does not write them, so
replace the plain string with an object that uses the **same** spec:

```jsonc
{
  "plugins": [
    {
      "package": "github:igorovh/opencode-better-worktrees#v0.2.0",
      "options": {
        "directoryRoot": "../.worktrees",
        "branchPrefix": "agent/",
        "instructions": true
      }
    }
  ]
}
```

| Option | Default | Meaning |
|---|---|---|
| `directoryRoot` | *(OpenCode decides)* | Parent directory for new worktrees. When unset, OpenCode puts them in its own per-project location (`~/.local/share/opencode/worktree/<project>/<name>`). Relative paths resolve against the project directory. Do not share one root between several repositories, or worktree names will collide. |
| `branchPrefix` | `"agent/"` | Prefix of the branch `worktree_create` suggests (`agent/<name>`). |
| `instructions` | `true` | Add the short worktree usage policy to the agent's context. |

The plugin has no TUI part, so `~/.config/opencode/cli.json` is not involved.

## Tools

| Tool | What it does |
|---|---|
| `worktree_create` | Create a worktree. Inputs: `name`, optional `branch` (suggested work branch) and `from` (starting ref, default `HEAD`). |
| `worktree_list` | List the project's worktrees, root first. `includeStatus` adds branch and change counts. |
| `worktree_status` | Show a worktree's branch, changed files and line counts. `includeDiff` adds patches. |
| `worktree_use` | Move the current session into a worktree. |
| `worktree_remove` | Remove a worktree. `force` only when you asked for destructive cleanup. |
| `worktree_refresh` | Make OpenCode re-read its worktree state after changes made outside OpenCode. |

## How it works

- **Worktree lifecycle.** Create, list, remove and refresh go to OpenCode's plugin worktree domain
  (`ctx.worktree`), always scoped to the current project. OpenCode chooses the strategy from the project's
  configuration and runs its setup scripts.
- **Detached HEAD.** New worktrees start in detached HEAD at `from`. The agent creates the reported branch
  (`git switch -c <branch>`) before its first commit.
- **Session moves.** A move only changes where the session points. Files are not copied or overwritten.
- **Status.** Status and diffs come from OpenCode's location-scoped VCS API, not from parsing Git output. In
  OpenCode 2.2.5 the plugin VCS API answers only for the directory the plugin was loaded in. For other worktrees
  `worktree_status` reports that status is unavailable instead of showing the wrong checkout's data, and
  `worktree_list` leaves the status fields out.
- **Concurrency.** Concurrent creates and removes of the same worktree are serialized.

## Development

```sh
bun install
bun test           # unit tests plus a real-git integration test
bun run typecheck
```

To try local changes, put the folder path in `plugins` instead of the GitHub spec, then restart OpenCode:

```jsonc
{
  "plugins": ["/path/to/opencode-better-worktrees"]
}
```

If the tools do not appear, check the OpenCode server log (`~/.local/share/opencode/log/`).

To re-record the demo GIF with [VHS](https://github.com/charmbracelet/vhs), build a throwaway repo and OpenCode
profile, then run the tape from that folder and copy its `demo.gif` to `docs/`:

```sh
bun docs/demo-setup.ts ~/demo   # any empty folder; the recording shows this path
cd ~/demo && vhs /path/to/opencode-better-worktrees/docs/demo.tape
```

## License

[MIT](LICENSE)
