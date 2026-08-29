/**
 * Minimal keyed async mutex.
 *
 * Used to serialize create/remove critical sections per resolved directory so
 * concurrent tool calls (possibly from parallel sessions sharing this plugin
 * instance) cannot create duplicate worktrees or race a removal against a
 * resolution.
 *
 * The plugin deliberately keeps NO other mutable state: session location
 * remains the single source of truth for "where am I working".
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>()

  /**
   * Run `fn` exclusively for `key`. Failures of `fn` do not poison the queue
   * for later callers; they are only surfaced to the caller of this run.
   */
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.tails.get(key) ?? Promise.resolve()
    const result = tail.then(fn, fn)
    this.tails.set(
      key,
      result.then(
        () => undefined,
        () => undefined,
      ),
    )
    return result
  }
}
