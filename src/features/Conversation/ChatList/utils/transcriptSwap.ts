/**
 * Whether rows in front of the conversation's tail were replaced wholesale.
 * Context compression does this by folding the history into a group, and a
 * failed compression by bringing it back; an older group can stay first through
 * both, so the first row alone does not tell. The browser clamps the offset to
 * the new list, so it no longer lines up with what the viewport was showing.
 *
 * Plain prepends and deletions only add or only remove rows, and an optimistic
 * id swapped for its server id sits at the tail with nothing after it.
 */
export const isTranscriptSwap = (prev: string[], next: string[]) => {
  if (prev.length === 0 || next.length === 0) return false;

  const prevIds = new Set(prev);
  const nextIds = new Set(next);
  const lastSurvivor = prev.findLast((id) => nextIds.has(id));
  if (lastSurvivor === undefined) return true;

  const removedInFront = prev
    .slice(0, prev.lastIndexOf(lastSurvivor))
    .some((id) => !nextIds.has(id));
  const addedInFront = next.slice(0, next.lastIndexOf(lastSurvivor)).some((id) => !prevIds.has(id));
  return removedInFront && addedInFront;
};
