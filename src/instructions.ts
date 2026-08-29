/**
 * Concise worktree usage policy injected into the agent's system context.
 * Deliberately short: it steers behavior without consuming context budget.
 */
export const INSTRUCTIONS_TEXT = `Managed worktrees policy:
- When the user asks you to work in a separate worktree, use the worktree_* tools. Never run git worktree commands yourself; OpenCode's managed worktree API is the source of truth.
- For independent parallel implementation tasks, prefer one managed worktree per task and delegate each task to its own session (worktree_delegate, or worktree_create + worktree_spawn_agent).
- After creating a worktree for your own work, move the current session into it with worktree_use before modifying files.
- Delegated sessions work inside their worktree automatically; track them with worktree_list and worktree_status.
- Never remove a worktree containing important uncommitted work unless the user explicitly requests force removal. If removal reports forceRequired, tell the user and wait for an explicit request.
- Do not create worktrees for trivial tasks; work directly unless isolation or parallelism is requested or clearly beneficial.`
