import type { TrashState } from './initialState';

const totalCount = (s: TrashState) =>
  Object.values(s.countByType).reduce((sum, count) => sum + (count ?? 0), 0);

const isEmpty = (s: TrashState) => s.isTrashInit && s.items.length === 0;

const isLoading = (id: string) => (s: TrashState) => s.loadingIds.includes(id);

export const trashSelectors = { isEmpty, isLoading, totalCount };
