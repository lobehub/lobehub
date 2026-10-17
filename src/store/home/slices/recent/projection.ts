import type { RecentItem } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';

export interface RecentListParams {
  limit: number;
}

/** Entry key of one recents query (`recentListMap[limit:N]`). */
export const createRecentQueryKey = (limit: number): string => `limit:${limit}`;

/**
 * Recent documents / tasks / topics, one entry per requested limit (the sidebar
 * asks for `pageSize + 1`, the drawer for 50). localStorage keeps the first
 * frame of the home sidebar instant.
 */
export const recentListResource = defineReplica<RecentListParams, RecentItem[]>({
  key: ({ limit }) => createRecentQueryKey(limit),
  name: 'recentList',
  storage: 'localStorage',
  version: 1,
});

export interface ResourceRecentParams {
  /** Workspace visibility filter; personal mode sends none. */
  visibility?: 'private' | 'public';
}

/** One resource-home recents query per visibility; the cache scope already carries the workspace. */
export const resourceRecentKey = ({ visibility }: ResourceRecentParams): string =>
  visibility ?? 'all';

/** What a resource-home "Recent files" card renders. */
export interface RecentFileCard {
  createdAt: Date | string;
  fileType?: string;
  id: string;
  name: string;
  url?: string;
}

/** What a resource-home "Recent pages" card renders. */
export interface RecentPageCard {
  emoji?: string;
  id: string;
  name: string;
  updatedAt: Date | string;
}

export const toRecentFileCard = ({
  createdAt,
  fileType,
  id,
  name,
  url,
}: RecentFileCard): RecentFileCard => ({ createdAt, fileType, id, name, url });

export const toRecentPageCard = ({
  id,
  metadata,
  name,
  updatedAt,
}: {
  id: string;
  metadata?: Record<string, any> | null;
  name: string;
  updatedAt: Date | string;
}): RecentPageCard => {
  const emoji = (metadata as { emoji?: unknown } | null | undefined)?.emoji;
  return { emoji: typeof emoji === 'string' ? emoji : undefined, id, name, updatedAt };
};

/**
 * A URL that carries a query string (a presigned storage URL in local dev) is a
 * short-lived credential; the stable `/f/:id` proxy URL production returns has none.
 */
const isCredentialUrl = (url: string): boolean => {
  try {
    return new URL(url, 'http://localhost').search !== '';
  } catch {
    return true;
  }
};

/** Persist file cards without credential-bearing URLs; the card falls back to its icon. */
export const toPersistedRecentFiles = (cards: RecentFileCard[]): RecentFileCard[] =>
  cards.map((card) => (card.url && isCredentialUrl(card.url) ? { ...card, url: undefined } : card));

/**
 * Resource home "Recent files". Slim cards only (no chunk / embedding status),
 * localStorage so the section paints the last rows on the first frame.
 */
export const recentFileListResource = defineReplica<ResourceRecentParams, RecentFileCard[]>({
  key: resourceRecentKey,
  name: 'resourceRecentFiles',
  storage: 'localStorage',
  version: 1,
});

/** Resource home "Recent pages": slim cards, never the page body. */
export const recentPageListResource = defineReplica<ResourceRecentParams, RecentPageCard[]>({
  key: resourceRecentKey,
  name: 'resourceRecentPages',
  storage: 'localStorage',
  version: 1,
});
