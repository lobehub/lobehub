import type { RecentItem } from '@lobechat/types';

import { defineReplica } from '@/libs/replica';
import type { fileService } from '@/services/file';

/**
 * Which entity types a recents query asks for:
 * - `sidebar`: documents and tasks (the home sidebar and the "all recents" drawer)
 * - `topic`: topics with their reply previews (the Home chat-mode recents block)
 * - `all`: every type, no previews (the desktop tray menu)
 */
export type RecentListTypes = 'all' | 'sidebar' | 'topic';

/**
 * Whose rows a recents query keeps. Workspace topics are shared, so `mine` is
 * narrowed on the server: client-filtering the top N of a team-wide feed could
 * starve out the viewer's own topics. `team` drops private agents / groups.
 */
export type RecentListView = 'mine' | 'team';

export interface RecentListParams {
  limit: number;
  /** Defaults to `sidebar`. */
  types?: RecentListTypes;
  /** Unset: no ownership filter. */
  view?: RecentListView;
}

/**
 * Entry key of one recents query (`recentListMap[...]`). Sidebar queries keep
 * the original `limit:N` key so their persisted rows still hydrate. The others
 * use `/` separators: the key ends up in the SWR sync key, and a `topic:`
 * substring would match a legacy CACHE_TIERS pattern and be persisted twice.
 */
export const createRecentQueryKey = (
  limit: number,
  { types = 'sidebar', view }: Omit<RecentListParams, 'limit'> = {},
): string =>
  types === 'sidebar' && !view ? `limit:${limit}` : `${types}/${view ?? 'any'}/limit:${limit}`;

/**
 * Recent documents / tasks / topics, one entry per query: the sidebar asks for
 * `pageSize + 1` documents and tasks, the drawer for 50, Home chat mode for its
 * own topics and the tray for every type. localStorage keeps their first frame
 * instant.
 */
export const recentListResource = defineReplica<RecentListParams, RecentItem[]>({
  key: ({ limit, types, view }) => createRecentQueryKey(limit, { types, view }),
  name: 'recentList',
  storage: 'localStorage',
  version: 1,
});

/** Entry key of one conversation-recents query (`conversationRecentMap[limit:N]`). */
export const createConversationRecentQueryKey = (limit: number): string => `limit:${limit}`;

/**
 * Latest topics per owner, for the IM conversation list. Kept apart from
 * `recentListResource`: the sidebar and the drawer want documents and tasks,
 * while this list needs topics with their reply previews.
 */
export const conversationRecentResource = defineReplica<RecentListParams, RecentItem[]>({
  key: ({ limit }) => createConversationRecentQueryKey(limit),
  name: 'conversationRecent',
  storage: 'localStorage',
  version: 1,
});

export type DocsHomeTab = 'mine' | 'recent' | 'shared';

export interface DocsHomeParams {
  tab: DocsHomeTab;
}

/** Rows the Docs home list shows; it fetches one head page per tab. */
export const DOCS_HOME_LIMIT = 50;

/** One row of the Docs home list: a page or an uploaded file. */
export interface DocsHomeRow {
  createdAt: Date | string;
  emoji?: string;
  fileType: string;
  id: string;
  kind: 'file' | 'page';
  /** Knowledge bases the row is filed into; empty for standalone rows. */
  knowledgeBaseIds: string[];
  name: string;
  owner?: { avatar?: string | null; id: string; name: string } | null;
  updatedAt: Date | string;
  userId?: string | null;
}

type DocsHomeItem = Awaited<ReturnType<typeof fileService.getDocsHomeItems>>[number];

/** Server row → list row. Slim on purpose: the list persists to localStorage. */
export const toDocsHomeRow = (item: DocsHomeItem): DocsHomeRow => {
  const emoji = (item.metadata as { emoji?: unknown } | null | undefined)?.emoji;
  const uploader = item.uploader;
  return {
    createdAt: item.createdAt,
    emoji: typeof emoji === 'string' ? emoji : undefined,
    fileType: item.fileType,
    id: item.id,
    knowledgeBaseIds: item.knowledgeBaseIds ?? [],
    kind: item.sourceType === 'document' ? 'page' : 'file',
    name: item.name,
    owner: uploader
      ? {
          avatar: uploader.avatar,
          id: uploader.id,
          name: uploader.fullName || uploader.username || uploader.id.slice(0, 8),
        }
      : null,
    updatedAt: item.updatedAt,
    userId: item.userId,
  };
};

/**
 * The Docs home list, one entry per tab. localStorage keeps the first frame
 * instant; the cache scope already carries the workspace.
 */
export const docsHomeListResource = defineReplica<DocsHomeParams, DocsHomeRow[]>({
  key: ({ tab }) => tab,
  name: 'docsHomeList',
  storage: 'localStorage',
  version: 1,
});
