/**
 * Abortable Request Manager
 *
 * Provides race condition control for async requests by canceling previous
 * requests when a new one with the same key is triggered.
 *
 * @example
 * ```ts
 * const result = await abortableRequest.execute(
 *   'update-user-profile',
 *   (signal) => api.updateProfile(data, { signal })
 * );
 * ```
 */
class AbortableRequestManager {
  private controllers = new Map<string, AbortController>();

  /**
   * Execute a request with race condition control
   * @param key - Unique key to identify the request group
   * @param fetcher - Request function that accepts AbortSignal
   * @returns Promise with the request result
   */
  async execute<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>): Promise<T> {
    // Cancel previous request with same key
    const existingController = this.controllers.get(key);
    if (existingController) {
      existingController.abort('New request triggered');
    }

    const controller = new AbortController();
    this.controllers.set(key, controller);

    try {
      return await fetcher(controller.signal);
    } finally {
      // Clean up controller if it's still the active one
      if (this.controllers.get(key) === controller) {
        this.controllers.delete(key);
      }
    }
  }

  /**
   * Manually cancel a request by key
   * @param key - Request key to cancel
   */
  cancel(key: string): void {
    const controller = this.controllers.get(key);
    if (controller) {
      controller.abort('Manually cancelled');
      this.controllers.delete(key);
    }
  }

  /**
   * Cancel all pending requests
   */
  cancelAll(): void {
    for (const controller of this.controllers.values()) {
      controller.abort('All requests cancelled');
    }
    this.controllers.clear();
  }
}

export const abortableRequest = new AbortableRequestManager();
