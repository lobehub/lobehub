import { type RecentItem } from '@/server/routers/lambda/recent';

export interface RecentState {
  allRecentsDrawerOpen: boolean;
  isRecentsInit: boolean;
  recents: RecentItem[];
}

export const initialRecentState: RecentState = {
  allRecentsDrawerOpen: false,
  isRecentsInit: false,
  recents: [],
};
