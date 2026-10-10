/**
 * What a copy's row in settings offers, decided apart from how it is drawn.
 */

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

interface CopySource {
  buildId?: string | null;
  inUse: boolean;
  status: string;
}

export const copyBlockReason = (
  instance: CopySource,
  occupancyUnavailable: boolean,
): CopyBlockReason | undefined => {
  if (instance.inUse) return 'inUse';
  if (occupancyUnavailable) return 'occupancyUnknown';
  if (instance.status === 'pending' && instance.buildId) return 'building';

  return undefined;
};

/** The copy entry's tooltip: what it does, or why it cannot right now. */
export const copyEntryTitle = (reason: CopyBlockReason | undefined) =>
  reason === 'inUse'
    ? 'environments.instances.copyInUse'
    : reason === 'occupancyUnknown'
      ? 'environments.instances.copyOccupancyUnknown'
      : reason === 'building'
        ? 'environments.instances.copyBuilding'
        : 'environments.instances.copy';

/**
 * Asks again, right before the copy dialog opens, whether the source is still
 * free. Occupancy changes without the page being told — a conversation picks
 * the copy up in another tab — so the answer the list was drawn with is not
 * trusted for the click.
 *
 * A failed re-read lets the dialog open: the check is a courtesy, and the
 * server checks again and says why.
 */
export const recheckCopySource = async (
  instanceId: string,
  refetch: () => Promise<
    { instances: (CopySource & { id: string })[]; occupancyUnavailable: boolean } | undefined
  >,
): Promise<CopyBlockReason | undefined> => {
  try {
    const fresh = await refetch();
    const latest = fresh?.instances.find((row) => row.id === instanceId);

    return latest ? copyBlockReason(latest, fresh?.occupancyUnavailable ?? false) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * What the row's delete entry deletes, or `undefined` when it has none.
 *
 * Never the default copy on its own: it is what the environment is, and the
 * server refuses to delete it. A broken one is rebuilt. When it is the only
 * copy, the entry is there and deletes the environment, which is how that copy
 * goes. Only for the environment's creator, like every other change to its
 * copies.
 */
export const deleteEntry = (
  instance: { isDefault: boolean },
  { editable, single }: { editable: boolean; single: boolean },
): 'environment' | 'instance' | undefined => {
  if (!editable) return undefined;
  if (single) return 'environment';

  return instance.isDefault ? undefined : 'instance';
};

/**
 * Whether the row offers to copy this copy at all — enabled or greyed out is
 * {@link copyBlockReason}'s answer. The creator's only: a colleague who can run
 * in a published environment cannot take its state with them.
 */
export const canCopyInstance = (editable: boolean) => editable;
