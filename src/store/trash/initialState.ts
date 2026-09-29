import type { TrashCountByType, TrashItem, TrashResourceType } from '@lobechat/types';

export interface TrashState {
  /** Type filter the recycle-bin page is currently showing (`undefined` = everything). */
  activeType?: TrashResourceType;
  countByType: TrashCountByType;
  /** A load-more page request is in flight — a second click must not fetch the same cursor. */
  isLoadingMore: boolean;
  isTrashInit: boolean;
  items: TrashItem[];
  /** Registry ids with an in-flight restore / purge — drives per-row spinners. */
  loadingIds: string[];
  nextCursor: string | null;
  /**
   * Cache scope (`user:workspace`) the list above was fetched for. SWR keys are
   * partitioned per workspace but this list is not, so a scope switch resets
   * it rather than showing the previous workspace's rows.
   */
  scope?: string;
}

export const initialState: TrashState = {
  activeType: undefined,
  countByType: {},
  isLoadingMore: false,
  isTrashInit: false,
  items: [],
  loadingIds: [],
  nextCursor: null,
  scope: undefined,
};
