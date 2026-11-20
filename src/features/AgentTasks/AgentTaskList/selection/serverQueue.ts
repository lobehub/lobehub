/**
 * Batches — and their undos — reach the server in click order. The list
 * already shows each one, so a second action never waits on screen, but two
 * writes to the same rows must land in the order the user made them, or the
 * list would settle on the earlier one.
 */
let serverQueue: Promise<unknown> = Promise.resolve();

export const enqueueBatchRequest = <T>(job: () => Promise<T>): Promise<T> => {
  const next = serverQueue.then(job, job);
  serverQueue = next.catch(() => undefined);
  return next;
};
