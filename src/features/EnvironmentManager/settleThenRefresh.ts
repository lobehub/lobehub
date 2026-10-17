/**
 * Run a mutation, then refresh the list it changed — whichever way it went.
 *
 * The refresh is best-effort and must never decide the outcome. Awaited in a
 * `finally`, a refresh that rejected replaced the mutation's own result: a stop
 * that succeeded read as "could not stop", and a refusal worth reading
 * (`SNAPSHOT_IN_PROGRESS`, "a conversation is using it") was swapped for an
 * unrelated revalidation error. The list catches up on its next revalidation.
 */
export const settleThenRefresh = async <T>(
  mutation: () => Promise<T>,
  refresh: () => Promise<unknown>,
): Promise<T> => {
  try {
    return await mutation();
  } finally {
    await refresh().catch(() => undefined);
  }
};
