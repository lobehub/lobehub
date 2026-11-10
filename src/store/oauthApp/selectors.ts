import { type OAuthAppStore } from './store';

const LIST_KEY = 'all';

/** `undefined` until the list has hydrated or answered. */
const appList = (s: OAuthAppStore) => s.appListMap[LIST_KEY];

/** `undefined` while loading, and for an app that does not exist (see `isAppNotFound`). */
const appById = (id: string) => (s: OAuthAppStore) => s.appDetailMap[id];

const isAppNotFound = (id: string) => (s: OAuthAppStore) => !!s.appNotFoundMap[id];

export const oauthAppSelectors = {
  appById,
  appList,
  isAppNotFound,
};
