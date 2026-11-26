/** Native calls outlive a renderer; replay must attach to that bounded invocation. */
export class McpInvocationRegistry {
  private readonly calls = new Map<string, { fingerprint: string; promise: Promise<unknown> }>();
  run<T>(
    key: string,
    fingerprint: string,
    deadline: number,
    execute: () => Promise<T>,
  ): Promise<T> {
    const existing = this.calls.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        return Promise.reject(
          new Error('MCP invocation identity was reused with different parameters'),
        );
      return existing.promise as Promise<T>;
    }
    const promise = Promise.resolve().then(execute);
    const entry = { fingerprint, promise };
    this.calls.set(key, entry);
    setTimeout(
      () => {
        if (this.calls.get(key) === entry) this.calls.delete(key);
      },
      Math.max(1, deadline - Date.now() + 300_000),
    ).unref();
    return promise;
  }
}
