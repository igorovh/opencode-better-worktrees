/** Serializes async work per key; a failed run does not block later callers. */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>()

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const tail = this.tails.get(key) ?? Promise.resolve()
    const result = tail.then(fn, fn)
    const settled = result.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(key, settled)
    // Drop the entry once idle so the map does not grow with every directory ever used.
    void settled.then(() => {
      if (this.tails.get(key) === settled) this.tails.delete(key)
    })
    return result
  }
}
