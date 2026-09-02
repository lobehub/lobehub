import type { TrashCountByType, TrashItem, TrashResourceType } from '@lobechat/types';

export interface TrashState {
  /** Type filter the recycle-bin page is currently showing (`undefined` = everything). */
  activeType?: TrashResourceType;
  countByType: TrashCountByType;
  isTrashInit: boolean;
  items: TrashItem[];
  /** Registry ids with an in-flight restore / purge — drives per-row spinners. */
  loadingIds: string[];
  nextCursor: string | null;
}

export const initialState: TrashState = {
  activeType: undefined,
  countByType: {},
  isTrashInit: false,
  items: [],
  loadingIds: [],
  nextCursor: null,
};
