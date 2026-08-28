/**
 * Run an async mapper over `items` with at most `limit` in flight.
 *
 * `Promise.all(items.map(fn))` fans out with no ceiling, which is fine for
 * cheap work and wrong for model calls: a 30-check acceptance would open 30
 * concurrent generations at once, hitting provider rate limits and turning one
 * user action into a burst the account is billed for whether or not the
 * responses are still wanted.
 *
 * Results keep the input order. A rejecting task rejects the whole call, same
 * as `Promise.all` — callers that need per-item tolerance resolve their own
 * failures inside `fn`.
 */
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) return [];

  const results = Array.from({ length: items.length }) as R[];
  const ceiling = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  const worker = async () => {
    while (true) {
      // Read-and-advance is atomic here because the loop body has no `await`
      // between the two statements — JS runs it to completion before any other
      // worker resumes, so no two workers can claim the same index.
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: ceiling }, () => worker()));

  return results;
};
