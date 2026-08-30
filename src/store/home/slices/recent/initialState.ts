import type { RecentItem } from '@lobechat/types';

export interface RecentState {
  allRecentsDrawerOpen: boolean;
  isRecentsInit: boolean;
  recents: RecentItem[];
  recentsScope: string | null;
}

export const initialRecentState: RecentState = {
  allRecentsDrawerOpen: false,
  isRecentsInit: false,
  recents: [],
  recentsScope: null,
};
