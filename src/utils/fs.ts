import { stat } from "node:fs/promises"

/** Existence probe for files and directories; injectable via `FsLike` in tests. */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
