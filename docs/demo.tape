# Demo of opencode-better-worktrees. First run `bun docs/demo-setup.ts [root]`, then run `vhs` on
# this file from that root; it writes demo.gif there. Copy it to docs/demo.gif.

Output demo.gif

# Written by demo-setup.ts: PowerShell on Windows, bash elsewhere.
Source shell.tape
Set FontSize 18
Set Width 1300
Set Height 560
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WindowBar Colorful

Hide
Type ". ./demo-env.ps1"
Enter
Sleep 1s
Show

Type `opencode run --standalone --auto "Use execute to create a worktree named auth-refactor from HEAD~1 and list all worktrees. Answer in one sentence."`
Sleep 500ms
Enter

# Skip the model's thinking time; the output appears once it finishes.
Hide
Wait+Screen@120s /(?s)opencode run.*acme-api>/
Show
Sleep 7s

Type "git worktree list"
Sleep 300ms
Enter
Sleep 4s
