import type { TrashState } from './initialState';
import { trashBucketKey, trashScopeKey } from './keys';

const totalCount = (scopeId: string | null) => (s: TrashState) =>
  Object.values(s.countByScope[trashScopeKey(scopeId)] ?? {}).reduce(
    (sum, count) => sum + (count ?? 0),
    0,
  );

const isEmpty =
  (scopeId: string | null, resourceType?: Parameters<typeof trashBucketKey>[1]) =>
  (s: TrashState) => {
    const bucket = s.listByBucket[trashBucketKey(scopeId, resourceType)];
    return Boolean(bucket?.isTrashInit && bucket.items.length === 0);
  };

const isLoading = (id: string) => (s: TrashState) => s.loadingIds.includes(id);

export const trashSelectors = { isEmpty, isLoading, totalCount };
