import { type RecentItem } from '@/server/routers/lambda/recent';

export interface RecentState {
  isRecentsInit: boolean;
  recents: RecentItem[];
}

export const initialRecentState: RecentState = {
  isRecentsInit: false,
  recents: [],
};
