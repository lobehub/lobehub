import { type HomeStore } from '@/store/home/store';

const recentTopics = (s: HomeStore) => s.recentTopics;
const recentResources = (s: HomeStore) => s.recentResources;
const recentPages = (s: HomeStore) => s.recentPages;
const recents = (s: HomeStore) => s.recents;

const isRecentTopicsInit = (s: HomeStore) => s.isRecentTopicsInit;
const isRecentResourcesInit = (s: HomeStore) => s.isRecentResourcesInit;
const isRecentPagesInit = (s: HomeStore) => s.isRecentPagesInit;
const isRecentsInit = (s: HomeStore) => s.isRecentsInit;

export const homeRecentSelectors = {
  isRecentPagesInit,
  isRecentResourcesInit,
  isRecentTopicsInit,
  isRecentsInit,
  recentPages,
  recentResources,
  recentTopics,
  recents,
};
