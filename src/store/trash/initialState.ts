import type { TrashCountByType, TrashItem } from '@lobechat/types';

export interface TrashState {
  countByScope: Record<string, TrashCountByType>;
  listByBucket: Record<
    string,
    { isTrashInit: boolean; items: TrashItem[]; nextCursor: string | null }
  >;
  /** Registry ids with an in-flight restore / purge — drives per-row spinners. */
  loadingIds: string[];
}

export const initialState: TrashState = {
  countByScope: {},
  listByBucket: {},
  loadingIds: [],
};
