import { type SessionStoreState } from '../../initialState';

const isRecentTopicsInit = (s: SessionStoreState) => s.isRecentTopicsInit;
const isRecentResourcesInit = (s: SessionStoreState) => s.isRecentResourcesInit;
const isRecentPagesInit = (s: SessionStoreState) => s.isRecentPagesInit;

const recentTopics = (s: SessionStoreState) => s.recentTopics;
const recentResources = (s: SessionStoreState) => s.recentResources;
const recentPages = (s: SessionStoreState) => s.recentPages;

export const recentSelectors = {
  isRecentPagesInit,
  isRecentResourcesInit,
  isRecentTopicsInit,
  recentPages,
  recentResources,
  recentTopics,
};
