import type {
  ResourceTrashCountByType,
  ResourceTrashItem,
  ResourceTrashType,
} from '@lobechat/types';

export interface TrashActionFeedback {
  key:
    | 'trash.purge.partial'
    | 'trash.purge.successCount'
    | 'trash.restore.failed.notFound'
    | 'trash.restore.failed.parentTrashed'
    | 'trash.restore.partial'
    | 'trash.restore.successCount';
  level: 'error' | 'success' | 'warning';
  params?: Record<string, number>;
}

export const getEmptyTrashActionState = ({
  activeType,
  countByType,
  countError,
  hasCountData,
}: {
  activeType?: ResourceTrashType;
  countByType: ResourceTrashCountByType;
  countError: unknown;
  hasCountData: boolean;
}) => {
  const total = Object.values(countByType).reduce((sum, count) => sum + (count ?? 0), 0);

  return {
    count: activeType ? (countByType[activeType] ?? 0) : total,
    ready: hasCountData && !countError,
    total,
  };
};

export const getRestoreFeedback = (outcome: {
  failed: { code: 'notFound' | 'parentTrashed' }[];
  restored: unknown[];
}): TrashActionFeedback => {
  if (outcome.failed.length > 0 && outcome.restored.length > 0) {
    return {
      key: 'trash.restore.partial',
      level: 'warning',
      params: { failed: outcome.failed.length, restored: outcome.restored.length },
    };
  }
  if (outcome.failed[0]) {
    return {
      key:
        outcome.failed[0].code === 'notFound'
          ? 'trash.restore.failed.notFound'
          : 'trash.restore.failed.parentTrashed',
      level: 'error',
    };
  }
  return {
    key: 'trash.restore.successCount',
    level: 'success',
    params: { count: outcome.restored.length },
  };
};

export const getPurgeFeedback = (outcome: {
  failed: unknown[];
  purged: number;
}): TrashActionFeedback =>
  outcome.failed.length > 0
    ? {
        key: 'trash.purge.partial',
        level: 'warning',
        params: { failed: outcome.failed.length, purged: outcome.purged },
      }
    : {
        key: 'trash.purge.successCount',
        level: 'success',
        params: { count: outcome.purged },
      };

export const getDeletedByLabel = (
  item: Pick<ResourceTrashItem, 'deletedByUserId' | 'workspaceId'>,
  members: Array<{
    user?: {
      email?: string | null;
      fullName?: string | null;
      username?: string | null;
    } | null;
    userId: string;
  }>,
  labels: { formerMember: string; you: string },
): string => {
  if (!item.workspaceId) return labels.you;
  const member = members.find((candidate) => candidate.userId === item.deletedByUserId);
  return (
    member?.user?.fullName?.trim() ||
    member?.user?.username?.trim() ||
    member?.user?.email?.split('@')[0] ||
    labels.formerMember
  );
};

export const toggleTrashSelection = (current: string[], id: string, checked: boolean): string[] =>
  checked ? [...new Set([...current, id])] : current.filter((itemId) => itemId !== id);
