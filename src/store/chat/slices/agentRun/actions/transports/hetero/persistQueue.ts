const HETERO_TERMINAL_PERSIST_DRAIN_TIMEOUT_MS = 10_000;

/** Wait for queued persistence; `false` means it timed out and the caller continues anyway. */
export const waitForPersistQueue = async (
  queue: Promise<void>,
  label: string,
  timeoutMs = HETERO_TERMINAL_PERSIST_DRAIN_TIMEOUT_MS,
): Promise<boolean> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const result = await Promise.race<
    { error: unknown; status: 'rejected' } | { status: 'resolved' } | { status: 'timeout' }
  >([
    queue.then(
      () => ({ status: 'resolved' }),
      (error) => ({ error, status: 'rejected' }),
    ),
    new Promise<{ status: 'timeout' }>((resolve) => {
      timeoutId = setTimeout(() => resolve({ status: 'timeout' }), timeoutMs);
    }),
  ]);

  if (timeoutId) clearTimeout(timeoutId);

  if (result.status === 'rejected') throw result.error;
  if (result.status === 'timeout') {
    console.warn(
      `[HeterogeneousAgent] persistQueue did not drain within ${timeoutMs}ms (${label}); continuing terminal flow.`,
    );
    return false;
  }

  return true;
};
