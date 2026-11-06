// Kept short on purpose: it is added to every model request.
export const INSTRUCTIONS_TEXT = `Managed worktrees policy:
- When the user asks you to work in a separate worktree, use the worktree_* tools. Never run git worktree commands yourself; OpenCode's managed worktree API is the source of truth.
- After creating a worktree for your own work, move the current session into it with worktree_use before modifying files.
- Managed worktrees start in detached HEAD. Before committing inside a worktree, run \`git switch -c <branch>\` using the branch name the create tool reported (branch prefix + worktree name by default).
- Track worktrees with worktree_list and worktree_status.
- Never remove a worktree containing important uncommitted work unless the user explicitly requests force removal. If removal reports forceRequired, tell the user and wait for an explicit request.
- Do not create worktrees for trivial tasks; work directly unless isolation is requested or clearly beneficial.`
