/**
 * Why a copy cannot be taken of this instance right now, or `undefined` when it
 * can.
 *
 * A copy captures the source's whole tree, so it is only taken of a source
 * nothing is writing to. The server refuses a held source with
 * `INSTANCE_IN_USE`; this answers the same question first, so the entry is
 * greyed out with the reason beside it instead of failing after a dialog has
 * been filled in.
 *
 * - `inUse`: a conversation, a build or the file browser holds it.
 * - `occupancyUnknown`: the lease store did not answer. Not read as free —
 *   the server refuses in that case too, for the same reason.
 * - `building`: a build is replacing its folder; what a copy took now would be
 *   half a checkout.
 */
export type CopyBlockReason = 'building' | 'inUse' | 'occupancyUnknown';

export const copyBlockReason = (
  instance: { buildId?: string | null; inUse: boolean; status: string },
  occupancyUnavailable: boolean,
): CopyBlockReason | undefined => {
  if (instance.inUse) return 'inUse';
  if (occupancyUnavailable) return 'occupancyUnknown';
  if (instance.status === 'pending' && instance.buildId) return 'building';

  return undefined;
};
