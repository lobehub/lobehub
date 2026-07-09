import { type RecentItem } from '@/server/routers/lambda/recent';

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
