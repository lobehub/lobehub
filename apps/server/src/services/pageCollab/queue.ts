const tails = new Map<string, Promise<unknown>>();

/**
 * Runs page edits one at a time per document within this process. Parallel tool
 * calls of one step land here; queueing them lets the second read what the
 * first wrote instead of failing on, or overwriting, a stale copy.
 */
export const runPageExclusive = <T>(documentId: string, task: () => Promise<T>): Promise<T> => {
  const previous = tails.get(documentId) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.catch(() => {});
  tails.set(documentId, tail);
  void tail.then(() => {
    if (tails.get(documentId) === tail) tails.delete(documentId);
  });
  return run;
};
