# Demo of opencode-better-worktrees. Run from the repo root: `vhs docs/demo.tape`.
# Needs a throwaway repo at E:\demo\acme-api and a private OpenCode profile in E:\demo\.opencode
# whose opencode.json lists only this plugin with "directoryRoot": "../worktrees".

Output docs/demo.gif

Set Shell "powershell"
Set FontSize 18
Set Width 1300
Set Height 560
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WindowBar Colorful

Hide
Type "$env:XDG_CONFIG_HOME='E:\demo\.opencode\config'; $env:XDG_DATA_HOME='E:\demo\.opencode\data'; $env:XDG_STATE_HOME='E:\demo\.opencode\state'; $env:XDG_CACHE_HOME='E:\demo\.opencode\cache'"
Enter
# OpenCode reads the PWD variable, which Set-Location does not update.
Type "Set-Location E:\demo\acme-api; $env:PWD='E:\demo\acme-api'; function prompt { 'acme-api> ' }; Clear-Host"
Enter
Sleep 1s
Show

Type `opencode2 run --standalone --auto "Use execute to create a worktree named auth-refactor from HEAD~1 and list all worktrees. Answer in one sentence."`
Sleep 500ms
Enter

# Skip the model's thinking time; the output appears once it finishes.
Hide
Wait+Screen@120s /(?s)opencode2 run.*acme-api>/
Show
Sleep 7s

Type "git worktree list"
Sleep 300ms
Enter
Sleep 4s
