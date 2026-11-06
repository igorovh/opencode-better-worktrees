// Builds the throwaway demo used by docs/demo.tape: `bun docs/demo-setup.ts [root]` (default: $DEMO_ROOT or ~/demo).
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { $ } from "bun"

const root = resolve(process.argv[2] ?? process.env.DEMO_ROOT ?? join(homedir(), "demo"))
const repo = join(root, "acme-api")
const profile = join(root, ".opencode")
if (existsSync(repo)) throw new Error(`${repo} already exists; pick another root or delete it first.`)

mkdirSync(join(repo, "src"), { recursive: true })
mkdirSync(join(profile, "config", "opencode"), { recursive: true })
writeFileSync(join(repo, "README.md"), "# acme-api\n\nTiny demo API.\n")
writeFileSync(join(repo, "src", "auth.ts"), 'export function login(user: string) {\n  return { user, token: "demo" }\n}\n')

const identity = { GIT_AUTHOR_NAME: "Demo", GIT_AUTHOR_EMAIL: "demo@example.com", GIT_COMMITTER_NAME: "Demo", GIT_COMMITTER_EMAIL: "demo@example.com" }
const git = (...args: string[]) => $`git ${args}`.cwd(repo).env({ ...process.env, ...identity }).quiet()
await git("init", "-q", "-b", "main")
await git("add", "-A")
await git("commit", "-q", "-m", "feat: initial API")
writeFileSync(join(repo, "src", "health.ts"), 'export function health() {\n  return "ok"\n}\n')
await git("add", "-A")
await git("commit", "-q", "-m", "feat: health endpoint")

const config = {
  plugins: [{ package: "github:igorovh/opencode-better-worktrees", options: { directoryRoot: "../worktrees" } }],
}
writeFileSync(join(profile, "config", "opencode", "opencode.json"), `${JSON.stringify(config, null, 2)}\n`)

// Sourced by the tape with `. ./demo-env.ps1`, which both PowerShell and bash accept.
const env = { XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data", XDG_STATE_HOME: "state", XDG_CACHE_HOME: "cache" }
const hasOpencode2 = Bun.which("opencode2") !== null
const script =
  process.platform === "win32"
    ? [
        ...Object.entries(env).map(([key, dir]) => `$env:${key}='${join(profile, dir)}'`),
        `Set-Location '${repo}'`,
        `$env:PWD='${repo}'`,
        ...(hasOpencode2 ? ["function opencode { opencode2 @args }"] : []),
        "function prompt { 'acme-api> ' }",
        "Clear-Host",
      ]
    : [
        ...Object.entries(env).map(([key, dir]) => `export ${key}='${join(profile, dir)}'`),
        `cd '${repo}'`,
        ...(hasOpencode2 ? ['opencode() { opencode2 "$@"; }'] : []),
        "PS1='acme-api> '",
        "clear",
      ]
writeFileSync(join(root, "demo-env.ps1"), `${script.join("\n")}\n`)
writeFileSync(join(root, "shell.tape"), `Set Shell "${process.platform === "win32" ? "powershell" : "bash"}"\n`)

console.log(`Demo ready in ${root}. Record it with:\n  cd ${root}\n  vhs ${resolve(import.meta.dir, "demo.tape")}`)
if (root.startsWith(homedir())) console.log("Note: the recording shows this path; pass a root outside your home folder to keep your user name out of it.")
