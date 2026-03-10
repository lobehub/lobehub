/**
 * Consumes a Response stream completely to ensure all callbacks are executed
 * @param response - The Response object with a ReadableStream body
 * @returns Promise that resolves when the stream is fully consumed
 *
 * @example
 * ```ts
 * const response = await modelRuntime.chat(payload, {
 *   callback: {
 *     onText: async (text) => {
 *       await saveToDatabase(text);
 *     }
 *   }
 * });
 *
 * // Ensure all callbacks complete before proceeding
 * await consumeStreamUntilDone(response);
 * ```
 */
export async function consumeStreamUntilDone(response: Response): Promise<void> {
  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
