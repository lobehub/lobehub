/** One rotation of the refresh icon, in ms. Matches `refreshSpin`'s duration. */
export const SPIN_TURN_MS = 600;

const MIN_TURNS = 2;

/**
 * How much longer to keep spinning once the refresh itself has settled.
 *
 * A refresh that resolves in 80ms would otherwise flash the icon for a frame and
 * read as "nothing happened". Hold the spin to a whole number of turns — at
 * least two — so the gesture always lands as one deliberate rotation instead of
 * stopping at whatever angle the network happened to finish on.
 */
export const spinHoldMs = (elapsedMs: number): number => {
  const turns = Math.max(MIN_TURNS, Math.ceil(elapsedMs / SPIN_TURN_MS));

  return turns * SPIN_TURN_MS - elapsedMs;
};
