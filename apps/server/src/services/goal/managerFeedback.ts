/** Task comments listed in one planning turn's message; older ones are counted, not shown. */
export const FEEDBACK_NOTE_LIMIT = 20;

/**
 * Split a planning turn's feedback at the previous turn's start, so the message
 * names what is new to this turn instead of resending the same comments every
 * turn. Only the latest `FEEDBACK_NOTE_LIMIT` are listed; the rest are counted
 * so the agent knows to read them in full rather than treating the list as all.
 */
export const splitManagerFeedback = <T extends { updatedAt: Date }>(
  notes: T[],
  previousTurnStartedAt?: string,
) => {
  const since = previousTurnStartedAt ? Date.parse(previousTurnStartedAt) : undefined;
  const isNew = (n: T) => since === undefined || n.updatedAt.getTime() > since;
  const listed = notes.slice(-FEEDBACK_NOTE_LIMIT);
  const omitted = notes.slice(0, -FEEDBACK_NOTE_LIMIT);
  const note = ({ updatedAt, ...rest }: T) => ({ ...rest, updatedAt: updatedAt.toISOString() });
  return {
    earlierFeedback: listed.filter((n) => !isNew(n)).map(note),
    newFeedback: listed.filter(isNew).map(note),
    omittedFeedback: {
      earlier: omitted.filter((n) => !isNew(n)).length,
      new: omitted.filter(isNew).length,
    },
  };
};
