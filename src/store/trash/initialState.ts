import type { ResourceTrashCountByType, ResourceTrashItem } from '@lobechat/types';

export interface TrashState {
  countByScope: Record<string, ResourceTrashCountByType>;
  listByBucket: Record<
    string,
    { isTrashInit: boolean; items: ResourceTrashItem[]; nextCursor: string | null }
  >;
  /** Registry ids with an in-flight restore / purge — drives per-row spinners. */
  loadingIds: string[];
}

export const initialState: TrashState = {
  countByScope: {},
  listByBucket: {},
  loadingIds: [],
};
