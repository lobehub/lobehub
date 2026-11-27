import type { TrashItem } from '@lobechat/types';
import type { ReactNode } from 'react';

import type { TrashViewFilter } from '@/services/trash';

export interface TrashPurgeNoticeTarget {
  /** A Workspace bin rather than the user's own. */
  isWorkspace: boolean;
  /** What the purge removes for good: the listed rows, or every root the emptied view covers. */
  target: { items: TrashItem[] } | { view: TrashViewFilter };
}

/**
 * What else a permanent delete loses, shown in its confirmation under the warning. Resolved
 * before the confirmation opens, so it can never be confirmed ahead of what it warns about; it
 * rejects when that cannot be told, and the confirmation then does not open.
 * Nothing by default: a deployment that keeps value on a resource (such as a balance) says
 * what is lost.
 */
export const loadTrashPurgeNotice = async (_target: TrashPurgeNoticeTarget): Promise<ReactNode> =>
  null;
