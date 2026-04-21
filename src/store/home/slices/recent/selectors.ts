import { type HomeStore } from '@/store/home/store';

const recents = (s: HomeStore) => s.recents;
const isRecentsInit = (s: HomeStore) => s.isRecentsInit;

export const homeRecentSelectors = {
  isRecentsInit,
  recents,
};
