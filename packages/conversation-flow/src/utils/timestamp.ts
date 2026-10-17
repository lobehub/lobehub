/**
 * Coerce a message timestamp into a numeric epoch value.
 *
 * The static contract on `UIChatMessage` is `createdAt: number`, but real-world
 * payloads violate it: the Gateway snapshot (LOBE-14005) serializes timestamps
 * as ISO strings, and historical DB rows can carry the same shape. Arithmetic
 * or relational comparison on a string silently produces `NaN`, which disables
 * every sort that relies on it — the renderer then falls back to traversal
 * order, surfacing as "out-of-order messages pinned at the bottom of the list".
 *
 * `toTime` accepts `number | string | Date` (and anything `new Date()` can
 * parse), so every ordering site in this package stays correct regardless of
 * which shape the caller passed in.
 */
export const toTime = (createdAt: number | string | Date): number => {
  if (typeof createdAt === 'number') return createdAt;
  return new Date(createdAt).getTime();
};
