/**
 * Root entrypoint for OpenCode's local plugin loader.
 *
 * Configured plugin directory targets require an `index.ts`/`index.js`
 * directly inside the directory (package.json `exports`/`main` are ignored
 * for local directories), and file-path entries are currently dropped
 * (anomalyco/opencode#46551). This re-export bridges the loader to the real
 * implementation in `src/index.ts`.
 */

export { default } from "./src/index.ts"
