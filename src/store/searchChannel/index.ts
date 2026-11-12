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
import { searchService } from '@/services/search';

/** Search providers and crawlers the server enables (`SEARCH_PROVIDERS` / `CRAWLER_IMPLS`). */
export interface AvailableSearchChannels {
  crawlerImpls: { id: string }[];
  searchProviders: { id: string }[];
}

/** The server answers one list for everyone, so the replica keeps a single entry. */
export const AVAILABLE_SEARCH_CHANNELS_KEY = 'default';

/**
 * Channels the Web Search settings page orders. Only channel ids are stored, in
 * localStorage under the user / workspace scope, so a reload paints the last
 * picker on the first frame while the server confirms it.
 */
export const availableSearchChannelsResource = defineReplica<string, AvailableSearchChannels>({
  key: (key) => key,
  name: 'availableSearchChannels',
  storage: 'localStorage',
  version: 1,
});

export interface SearchChannelStoreState {
  channelsMap: Record<string, AvailableSearchChannels>;
  channelsReplica: ReplicaState<AvailableSearchChannels>;
}

interface SearchChannelStore extends SearchChannelStoreState {
  /** Fetch orchestration only; read the channels with `useAvailableSearchChannels`. */
  useFetchAvailableChannels: () => ReplicaSyncResult;
}

export const initialSearchChannelState: SearchChannelStoreState = {
  channelsMap: {},
  channelsReplica: createReplicaState(),
};

export const useSearchChannelStore: UseBoundStoreWithEqualityFn<StoreApi<SearchChannelStore>> =
  createWithEqualityFn<SearchChannelStore>()((set, get) => {
    const channels = createReplicaSlice(availableSearchChannelsResource, {
      actionPrefix: 'searchChannel/channels',
      fetcher: () => searchService.getAvailableChannels(),
      get,
      set,
      stateKey: 'channelsReplica',
      view: recordLens<SearchChannelStore, AvailableSearchChannels>('channelsMap'),
    });

    return {
      ...initialSearchChannelState,
      useFetchAvailableChannels: () => channels.useSync(AVAILABLE_SEARCH_CHANNELS_KEY),
    };
  }, shallow);

/** The available channels, or `undefined` while neither persisted nor fetched. */
export const useAvailableSearchChannels = () =>
  useSearchChannelStore((state) => state.channelsMap[AVAILABLE_SEARCH_CHANNELS_KEY]);
