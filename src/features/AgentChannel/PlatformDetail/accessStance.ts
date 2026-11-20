/**
 * The page asks people one question — "who can DM it?" — while the runtime
 * answers it with three settings (`dmPolicy`, the global `allowFrom` list and
 * the owner's `userId`). These helpers translate between the two without
 * pretending they are the same thing:
 *
 * - A non-empty `allowFrom` restricts everyone, in DMs and in groups, whatever
 *   `dmPolicy` says. So "everyone" is only true when the list is empty, and a
 *   stored `open` policy with a filled list reads as "listed people only".
 * - `pairing` is the one policy that lets strangers through to a pairing code
 *   first, and it needs the owner's `userId` to approve them.
 */

export type DmStance = 'approval' | 'closed' | 'everyone' | 'listed';

export interface StanceSettings {
  allowFrom?: unknown;
  dmPolicy?: string;
}

/** How many usable rows (with an ID) a list holds. */
export const countListed = (list: unknown): number =>
  Array.isArray(list)
    ? list.filter(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          String((entry as { id?: unknown }).id ?? '').trim() !== '',
      ).length
    : 0;

export const deriveDmStance = ({ allowFrom, dmPolicy }: StanceSettings): DmStance => {
  switch (dmPolicy) {
    case 'pairing': {
      return 'approval';
    }
    case 'disabled': {
      return 'closed';
    }
    case 'allowlist': {
      return 'listed';
    }
    default: {
      return countListed(allowFrom) > 0 ? 'listed' : 'everyone';
    }
  }
};

export interface StanceChange {
  /** People who would fall off the list by applying the stance. */
  dropped: number;
  patch: { allowFrom?: never[]; dmPolicy: 'allowlist' | 'disabled' | 'open' | 'pairing' };
}

/**
 * The form changes that make `stance` true. Only "everyone" touches the list,
 * because a filled list would otherwise keep restricting everyone.
 */
export const applyDmStance = (stance: DmStance, settings: StanceSettings): StanceChange => {
  switch (stance) {
    case 'approval': {
      return { dropped: 0, patch: { dmPolicy: 'pairing' } };
    }
    case 'closed': {
      return { dropped: 0, patch: { dmPolicy: 'disabled' } };
    }
    case 'listed': {
      return { dropped: 0, patch: { dmPolicy: 'allowlist' } };
    }
    default: {
      return {
        dropped: countListed(settings.allowFrom),
        patch: { allowFrom: [], dmPolicy: 'open' },
      };
    }
  }
};

export type AccessIssue = 'approverMissing' | 'groupListEmpty' | 'listEmpty';

export interface AccessSettings extends StanceSettings {
  deviceAllowFrom?: unknown;
  deviceChannelAllowFrom?: unknown;
  deviceChannelPolicy?: string;
  devicePolicy?: string;
  groupAllowFrom?: unknown;
  groupPolicy?: string;
  userId?: unknown;
}

/** Things that leave the current choice not working the way it reads. */
export const accessIssues = (settings: AccessSettings): AccessIssue[] => {
  const issues: AccessIssue[] = [];
  const userId = typeof settings.userId === 'string' ? settings.userId.trim() : '';

  if (settings.dmPolicy === 'pairing' && !userId) issues.push('approverMissing');
  if (settings.dmPolicy === 'allowlist' && countListed(settings.allowFrom) === 0)
    issues.push('listEmpty');
  if (settings.groupPolicy === 'allowlist' && countListed(settings.groupAllowFrom) === 0)
    issues.push('groupListEmpty');

  return issues;
};

const hasId = (entry: unknown) =>
  typeof entry === 'string'
    ? entry.trim() !== ''
    : !!entry &&
      typeof entry === 'object' &&
      String((entry as { id?: unknown }).id ?? '').trim() !== '';

/**
 * Rows without an ID in a list the page has just hidden. A hidden list stays mounted (so a saved
 * list is never dropped), which also keeps its "ID required" check alive: a half-added row would
 * block every save with an error nobody can see. Returns only the lists that changed.
 */
export const dropHiddenIncompleteRows = (
  settings: AccessSettings & { groupAllowFrom?: unknown; groupPolicy?: string },
): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  const prune = (
    key: 'allowFrom' | 'deviceAllowFrom' | 'deviceChannelAllowFrom' | 'groupAllowFrom',
  ) => {
    const list = settings[key];
    if (Array.isArray(list) && list.some((entry) => !hasId(entry))) patch[key] = list.filter(hasId);
  };

  const stance = deriveDmStance(settings);
  const peopleListShown =
    stance === 'approval' || stance === 'listed' || countListed(settings.allowFrom) > 0;
  if (!peopleListShown) prune('allowFrom');
  if (settings.groupPolicy !== 'allowlist') prune('groupAllowFrom');
  if (settings.devicePolicy !== 'allowlist') prune('deviceAllowFrom');
  if (settings.deviceChannelPolicy !== 'allowlist') prune('deviceChannelAllowFrom');

  return patch;
};
