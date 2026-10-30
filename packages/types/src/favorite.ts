/**
 * What a sidebar favorite points at. A resource type identifies the row by
 * `targetId`; `route` keeps any other in-app page, identified by its path.
 * Plain text in the database, so a new type is a type-only change.
 */
export const FAVORITE_TYPES = [
  'agent',
  'dashboard',
  'goal',
  'group',
  'page',
  'project',
  'route',
  'task',
  'topic',
] as const;

export type FavoriteType = (typeof FAVORITE_TYPES)[number];

/**
 * Most favorites one sidebar holds. A reorder sends the whole list, so adding
 * stops where a reorder payload is still accepted.
 */
export const FAVORITE_LIMIT = 1000;

/** Longest title a favorite keeps. Longer page titles are cut rather than refused. */
export const FAVORITE_TITLE_MAX_LENGTH = 512;

/** A title as a favorite stores it: trimmed, then cut on a code point so an emoji is never split. */
export const toFavoriteTitle = (title: string): string =>
  Array.from(title.trim()).slice(0, FAVORITE_TITLE_MAX_LENGTH).join('');

export interface FavoriteItem {
  /** Emoji or avatar URL captured when the item was favorited; null falls back to the type icon. */
  icon: string | null;
  id: string;
  /**
   * In-app path without the workspace slug, e.g. `/agent/agt_x/tpc_y`. The
   * client adds the active workspace prefix when it navigates.
   */
  path: string;
  /** Resource id for resource types, the path for `route`. */
  targetId: string;
  /** Title snapshot; refreshed while the favorited page is open. */
  title: string;
  type: FavoriteType;
}

export interface AddFavoriteParams {
  icon?: string | null;
  path: string;
  targetId: string;
  title: string;
  type: FavoriteType;
}
