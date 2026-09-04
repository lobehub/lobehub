import { type RouterStoreState } from './store';

const hash = (state: RouterStoreState) => state.location.hash;
const key = (state: RouterStoreState) => state.location.key;
const matches = (state: RouterStoreState) => state.matches;
const pathname = (state: RouterStoreState) => state.location.pathname;
const search = (state: RouterStoreState) => state.location.search;
const url = (state: RouterStoreState) => state.location.pathname + state.location.search;
const fullUrl = (state: RouterStoreState) => url(state) + state.location.hash;

export const routerSelectors = {
  fullUrl,
  hash,
  key,
  matches,
  pathname,
  search,
  url,
};
