import { type HomeStore } from '@/store/home/store';

const recentTopics = (s: HomeStore) => s.recentTopics;
const recentResources = (s: HomeStore) => s.recentResources;
const recentPages = (s: HomeStore) => s.recentPages;

const isRecentTopicsInit = (s: HomeStore) => s.isRecentTopicsInit;
const isRecentResourcesInit = (s: HomeStore) => s.isRecentResourcesInit;
const isRecentPagesInit = (s: HomeStore) => s.isRecentPagesInit;

export const homeRecentSelectors = {
  isRecentPagesInit,
  isRecentResourcesInit,
  isRecentTopicsInit,
  recentPages,
  recentResources,
  recentTopics,
};
