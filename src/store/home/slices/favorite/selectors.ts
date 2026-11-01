import type { FavoriteItem, FavoriteType } from '@lobechat/types';

import type { HomeStoreState } from '@/store/home/initialState';

import { FAVORITE_LIST_KEY } from './projection';

const EMPTY: FavoriteItem[] = [];

/** `undefined` until the list has loaded (or hydrated) for this scope. */
const favoriteList = (s: HomeStoreState): FavoriteItem[] | undefined =>
  s.favoriteListMap[FAVORITE_LIST_KEY];

const favorites = (s: HomeStoreState): FavoriteItem[] => favoriteList(s) ?? EMPTY;

const getFavorite =
  (type: FavoriteType, targetId: string) =>
  (s: HomeStoreState): FavoriteItem | undefined =>
    favorites(s).find((item) => item.type === type && item.targetId === targetId);

const isFavorite = (type: FavoriteType, targetId: string) => (s: HomeStoreState) =>
  !!getFavorite(type, targetId)(s);

export const favoriteSelectors = {
  favoriteList,
  favorites,
  getFavorite,
  isFavorite,
};
