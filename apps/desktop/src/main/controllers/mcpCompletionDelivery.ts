/** Delivery can be retried; the native tools/call must never be replayed for a lost relay ACK. */
export class McpCompletionDelivery {
  private readonly deliveries = new Map<string, Promise<void>>();

  deliver(key: string, deadline: number, publish: () => Promise<boolean>): Promise<void> {
    const existing = this.deliveries.get(key);
    if (existing) return existing;
    const delivery = this.publishUntilDeadline(deadline, publish);
    this.deliveries.set(key, delivery);
    const cleanup = setTimeout(
      () => this.deliveries.delete(key),
      Math.max(1, deadline - Date.now() + 300_000),
    );
    cleanup.unref();
    return delivery;
  }

  private async publishUntilDeadline(deadline: number, publish: () => Promise<boolean>) {
    let attempt = 0;
    while (Date.now() < deadline) {
      // false means a permanent authorization/identity failure: never follow a new login.
      try {
        await publish();
        return;
      } catch (error) {
        console.warn('MCP completion delivery failed; retaining native receipt for retry', error);
      }
      const delay = Math.min(10_000, 500 * 2 ** Math.min(attempt++, 5), deadline - Date.now());
      if (delay <= 0) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        timer.unref();
      });
    }
  }
}
