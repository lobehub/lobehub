import type { StoreApi } from 'zustand';
import { shallow } from 'zustand/shallow';
import { createWithEqualityFn, type UseBoundStoreWithEqualityFn } from 'zustand/traditional';

import {
  createReplicaSlice,
  createReplicaState,
  defineReplica,
  recordLens,
  type ReplicaState,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { lambdaClient } from '@/libs/trpc/client';
import { type ChangelogIndexItem } from '@/types/changelog';

/** The fields of a changelog post the modal renders; the rest is never stored. */
export interface ChangelogPost {
  content: string;
  image?: string;
  rawTitle?: string;
  title: string;
}

export interface ChangelogPostParams {
  id: string;
  locale: string;
}

/** The server answers one index for everyone, so the replica keeps a single entry. */
export const CHANGELOG_INDEX_KEY = 'default';

/** How many posts (per locale) survive a reload (`persist.maxEntries`). */
export const MAX_PERSISTED_CHANGELOG_POSTS = 30;

export const changelogPostKey = ({ id, locale }: ChangelogPostParams) =>
  JSON.stringify([id, locale]);

/** Changelog index of the "What's new" modal, in localStorage for a first-frame paint. */
export const changelogIndexResource = defineReplica<string, ChangelogIndexItem[]>({
  key: (key) => key,
  name: 'changelogIndex',
  storage: 'localStorage',
  version: 1,
});

/**
 * One changelog post per id + locale. Only the rendered fields are kept, and at
 * most {@link MAX_PERSISTED_CHANGELOG_POSTS} rows per scope (least recently
 * used evicted). A post the server cannot find is `null`.
 */
export const changelogPostResource = defineReplica<ChangelogPostParams, ChangelogPost | null>({
  key: changelogPostKey,
  name: 'changelogPost',
  persist: { maxEntries: MAX_PERSISTED_CHANGELOG_POSTS },
  storage: 'indexedDB',
  version: 1,
});

const fetchChangelogPost = async ({
  id,
  locale,
}: ChangelogPostParams): Promise<ChangelogPost | null> => {
  const post = await lambdaClient.changelog.getPostById.query({ id, locale });
  if (!post) return null;

  return {
    content: post.content,
    image: post.image,
    rawTitle: post.rawTitle,
    title: post.title,
  };
};

export interface ChangelogStoreState {
  indexMap: Record<string, ChangelogIndexItem[]>;
  indexReplica: ReplicaState<ChangelogIndexItem[]>;
  postMap: Record<string, ChangelogPost | null>;
  postReplica: ReplicaState<ChangelogPost | null>;
}

interface ChangelogStore extends ChangelogStoreState {
  /** Fetch orchestration only; read the index with `useChangelogIndex`. */
  useFetchChangelogIndex: () => ReplicaSyncResult;
  /** Fetch orchestration only; read the post with `useChangelogPost`. */
  useFetchChangelogPost: (params: ChangelogPostParams) => ReplicaSyncResult;
}

export const initialChangelogState: ChangelogStoreState = {
  indexMap: {},
  indexReplica: createReplicaState(),
  postMap: {},
  postReplica: createReplicaState(),
};

export const useChangelogStore: UseBoundStoreWithEqualityFn<StoreApi<ChangelogStore>> =
  createWithEqualityFn<ChangelogStore>()((set, get) => {
    const index = createReplicaSlice(changelogIndexResource, {
      actionPrefix: 'changelog/index',
      fetcher: () => lambdaClient.changelog.getIndex.query(),
      get,
      set,
      stateKey: 'indexReplica',
      view: recordLens<ChangelogStore, ChangelogIndexItem[]>('indexMap'),
    });

    const posts = createReplicaSlice(changelogPostResource, {
      actionPrefix: 'changelog/posts',
      fetcher: fetchChangelogPost,
      get,
      set,
      stateKey: 'postReplica',
      view: recordLens<ChangelogStore, ChangelogPost | null>('postMap'),
    });

    return {
      ...initialChangelogState,
      useFetchChangelogIndex: () => index.useSync(CHANGELOG_INDEX_KEY),
      useFetchChangelogPost: (params) => posts.useSync(params),
    };
  }, shallow);

/** The changelog index, or `undefined` while neither persisted nor fetched. */
export const useChangelogIndex = () =>
  useChangelogStore((state) => state.indexMap[CHANGELOG_INDEX_KEY]);

/** One post, `null` when the server has none, `undefined` while loading. */
export const useChangelogPost = (params: ChangelogPostParams) =>
  useChangelogStore((state) => state.postMap[changelogPostKey(params)]);
