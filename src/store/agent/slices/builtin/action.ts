import { type AgentItem, type LobeAgentConfig } from '@lobechat/types';
import { useLayoutEffect } from 'react';
import { type PartialDeep } from 'type-fest';

import {
  cacheScope,
  createReplicaSlice,
  type ReplicaLens,
  type ReplicaSyncResult,
} from '@/libs/replica';
import { agentService } from '@/services/agent';
import { type StoreSetter } from '@/store/types';

import { type AgentStore } from '../../store';
import { type BuiltinAgentParams, builtinAgentResource } from './projection';

interface UseInitBuiltinAgentContext {
  /**
   * Whether the user is logged in.
   * When false or undefined, the hook will not fetch the agent.
   */
  isLogin?: boolean;
}

/** `useInitBuiltinAgent` result: replica flags plus the SWR-era aliases. */
export interface BuiltinAgentSyncResult extends ReplicaSyncResult {
  /** A request is in flight and there is nothing cached to show for this entry yet. */
  isLoading: boolean;
  /** Alias of `revalidate`. */
  mutate: () => Promise<unknown>;
}

const fetchBuiltinAgent = ({ slug }: BuiltinAgentParams): Promise<AgentItem> =>
  agentService.getBuiltinAgent(slug) as Promise<AgentItem>;

/**
 * The replica view keeps the long-standing `builtinAgentIdMap` (slug → id) as a
 * derived index alongside the materialized `builtinAgentMap` (slug → item): the
 * id index is what selectors and route loaders read, and the full item is what
 * re-seeds `agentMap` before paint. Both move in one commit, so a reader never
 * sees an id without its item (or vice versa).
 */
const builtinAgentLens: ReplicaLens<AgentStore, AgentItem> = {
  clear: () => ({ builtinAgentIdMap: {}, builtinAgentMap: {} }),
  get: (state, key) => state.builtinAgentMap[key],
  keys: (state) => Object.keys(state.builtinAgentMap),
  set: (state, key, data) => {
    const map = { ...state.builtinAgentMap };
    const idMap = { ...state.builtinAgentIdMap };

    if (data === undefined) {
      delete map[key];
      delete idMap[key];
    } else {
      map[key] = data;
      if (data.id) idMap[key] = data.id;
      else delete idMap[key];
    }

    return { builtinAgentIdMap: idMap, builtinAgentMap: map };
  },
};

/**
 * Builtin Agent Slice Actions
 * Handles initialization and management of builtin agents (page-agent, inbox, etc.)
 *
 * The server row is a replica: the first frame paints the persisted id + config,
 * the network only confirms, and the store remains the only writer of
 * `builtinAgentMap` / `builtinAgentIdMap`.
 */

type Setter = StoreSetter<AgentStore>;
export const createBuiltinAgentSlice = (set: Setter, get: () => AgentStore, _api?: unknown) =>
  new BuiltinAgentSliceActionImpl(set, get, _api);

export class BuiltinAgentSliceActionImpl {
  readonly #builtin;
  readonly #get: () => AgentStore;

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    this.#get = get;
    this.#builtin = createReplicaSlice(builtinAgentResource, {
      actionPrefix: 'builtinAgent',
      fetcher: fetchBuiltinAgent,
      get,
      set,
      stateKey: 'builtinAgentReplica',
      view: builtinAgentLens,
    });
  }

  /**
   * Seed `agentMap` so a surface reading the builtin's own config (inbox
   * identity / artwork) paints it instead of the default chief. In-memory only:
   * the persisted copy lives in the builtin replica, not `agentConfig`.
   */
  #seedAgentMap = (item: AgentItem | null | undefined): void => {
    if (!item?.id) return;
    this.#get().internal_dispatchAgentMap(item.id, item as PartialDeep<LobeAgentConfig>);
  };

  /**
   * Whether `scope` is still the identity the replica is partitioned by. An
   * async round-trip resolves under the scope it started in; a result that
   * arrives after an identity switch must not paint or seed the switched-to
   * identity's view (the engine drops the replica write, this guards the
   * `agentMap` seed that sits outside the replica).
   */
  #isCurrentScope = (scope: string): boolean => this.#builtin.resource.scope.get() === scope;

  /**
   * Confirm a builtin agent's latest value without a network round-trip — the
   * authoritative update response is already in hand (e.g. after a meta edit).
   * Writes the slug → id index and its item, then seeds `agentMap`. A response
   * captured under a scope that is no longer active is dropped.
   */
  internal_replaceBuiltinAgent = (
    slug: string,
    item: AgentItem,
    scope = cacheScope.get(),
  ): void => {
    if (!item?.id) return;
    this.#builtin.replace({ slug }, item, scope);
    if (this.#isCurrentScope(scope)) this.#seedAgentMap(item);
  };

  /**
   * Re-read a builtin agent from the network and confirm it locally.
   *
   * Imperative by design: unlike the mount-time `useInitBuiltinAgent` sync, it
   * does not depend on a mounted subscriber, so the create-Agent / create-Page
   * flows can ensure a slug resolves on demand.
   *
   * The scope is captured before the await: when the identity changes while the
   * request is in flight, the late response is not written into the new scope,
   * matching the guard the swap-era code applied with `scope === getCacheScope()`.
   */
  refreshBuiltinAgent = async (slug: string): Promise<void> => {
    const scope = cacheScope.get();
    const data = await fetchBuiltinAgent({ slug });
    if (!data?.id) return;
    this.internal_replaceBuiltinAgent(slug, data, scope);
  };

  useInitBuiltinAgent = (
    slug: string,
    context?: UseInitBuiltinAgentContext,
  ): BuiltinAgentSyncResult => {
    // The old SWR sync never refetched on focus / reconnect: a builtin's identity
    // and config change through an explicit edit, not by the tab regaining focus.
    const sync = this.#builtin.useSync(context?.isLogin === false ? null : { slug }, {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    });
    const data = this.#get().builtinAgentMap[slug];

    /**
     * Cache hits do not invoke SWR's onSuccess. Restore the identity and artwork
     * before paint on every commit of the entry (hydrate as well as background
     * revalidation), so a reload does not briefly display the default chief. The
     * scope guard is the engine's: a response from an obsolete identity scope is
     * dropped before it reaches this view.
     */
    useLayoutEffect(() => {
      if (context?.isLogin === false) return;
      this.#seedAgentMap(data);
    }, [data, context?.isLogin]);

    return {
      ...sync,
      isLoading: sync.isValidating && !data,
      mutate: sync.revalidate,
    };
  };

  /**
   * Seed the persisted builtin agent — the slug → id mapping and its config —
   * before a route loader resolves a slug (see `agentChatTopicListLoader`).
   * A route loader is the one place the async (IndexedDB) read can land before
   * the route commits, so the id is known without waiting for the network.
   */
  preHydrateBuiltinAgent = async (slug: string): Promise<boolean> => {
    const scope = cacheScope.get();
    this.#builtin.ensureScope(scope);
    const hydrated = await this.#builtin.hydrate({ slug }, scope);
    this.#seedAgentMap(this.#get().builtinAgentMap[slug]);

    return hydrated;
  };
}

export type BuiltinAgentSliceAction = Pick<
  BuiltinAgentSliceActionImpl,
  keyof BuiltinAgentSliceActionImpl
>;
