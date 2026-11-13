/**
 * Wait for every started operation to finish, then rethrow the first failure.
 * Unlike `Promise.all`, a rejection does not return early while sibling writes
 * are still running (and could commit after the caller reported failure), and
 * no rejection is left unhandled.
 */
export const settleAll = async (ops: Promise<unknown>[]): Promise<void> => {
  const results = await Promise.allSettled(ops);
  const failed = results.find((result): result is PromiseRejectedResult => {
    return result.status === 'rejected';
  });
  if (failed) throw failed.reason;
};
