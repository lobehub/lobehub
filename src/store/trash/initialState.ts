import type { TrashCountByType, TrashItem, TrashResourceType } from '@lobechat/types';

export interface TrashState {
  /** Type filter the recycle-bin page is currently showing (`undefined` = everything). */
  activeType?: TrashResourceType;
  countByType: TrashCountByType;
  countScopeId?: string | null;
  isTrashInit: boolean;
  items: TrashItem[];
  itemsScopeId?: string | null;
  /** Registry ids with an in-flight restore / purge — drives per-row spinners. */
  loadingIds: string[];
  nextCursor: string | null;
}

export const initialState: TrashState = {
  activeType: undefined,
  countByType: {},
  countScopeId: undefined,
  isTrashInit: false,
  items: [],
  itemsScopeId: undefined,
  loadingIds: [],
  nextCursor: null,
};
