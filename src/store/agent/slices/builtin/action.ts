import { type AgentItem, type LobeAgentConfig } from '@lobechat/types';
import { useLayoutEffect } from 'react';
import { type SWRResponse } from 'swr';
import { type PartialDeep } from 'type-fest';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { builtinAgentKeys } from '@/libs/swr/keys';
import { getCacheScope, useCacheScope } from '@/libs/swr/useCacheScope';
import { agentService } from '@/services/agent';
import { type StoreSetter } from '@/store/types';

import { type AgentStore } from '../../store';

interface UseInitBuiltinAgentContext {
  /**
   * Whether the user is logged in.
   * When false or undefined, the hook will not fetch the agent.
   */
  isLogin?: boolean;
}

/**
 * Builtin Agent Slice Actions
 * Handles initialization and management of builtin agents (page-agent, inbox, etc.)
 */

type Setter = StoreSetter<AgentStore>;
export const createBuiltinAgentSlice = (set: Setter, get: () => AgentStore, _api?: unknown) =>
  new BuiltinAgentSliceActionImpl(set, get, _api);

export class BuiltinAgentSliceActionImpl {
  readonly #get: () => AgentStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => AgentStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  refreshBuiltinAgent = async (slug: string): Promise<void> => {
    const scope = getCacheScope();
    const data = await agentService.getBuiltinAgent(slug);
    if (data?.id && scope === getCacheScope()) {
      this.#get().internal_dispatchAgentMap(data.id, data as PartialDeep<LobeAgentConfig>);
      // Mirror useInitBuiltinAgent's hydration: keep builtinAgentIdMap in sync
      // so callers can rely on this as a real "ensure" path instead of just a
      // post-init refresh.
      this.#set(
        { builtinAgentIdMap: { ...this.#get().builtinAgentIdMap, [slug]: data.id } },
        false,
        `refreshBuiltinAgent/${slug}`,
      );
      await mutate(builtinAgentKeys.init(slug, scope), data, { revalidate: false });
    }
  };

  useInitBuiltinAgent = (
    slug: string,
    context?: UseInitBuiltinAgentContext,
  ): SWRResponse<AgentItem | null> => {
    const scope = useCacheScope();
    const response = useClientDataSWR<AgentItem | null>(
      context?.isLogin === false ? null : builtinAgentKeys.init(slug, scope),
      async () => {
        const data = await agentService.getBuiltinAgent(slug);

        return scope === getCacheScope() ? (data as AgentItem | null) : null;
      },
      {
        dedupingInterval: 2000,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
      },
    );

    const { data } = response;
    /**
     * Cache hits do not invoke SWR's onSuccess. Restore the identity and artwork
     * before paint as well as after revalidation, so a reload does not briefly
     * display the default chief. Ignore responses from an obsolete identity scope.
     */
    useLayoutEffect(() => {
      if (context?.isLogin === false || !data?.id || scope !== getCacheScope()) return;

      this.#get().internal_dispatchAgentMap(data.id, data as PartialDeep<LobeAgentConfig>);
      this.#set(
        { builtinAgentIdMap: { ...this.#get().builtinAgentIdMap, [slug]: data.id } },
        false,
        `useInitBuiltinAgent/${slug}`,
      );
    }, [data, slug, scope, context?.isLogin]);

    return response;
  };
}

export type BuiltinAgentSliceAction = Pick<
  BuiltinAgentSliceActionImpl,
  keyof BuiltinAgentSliceActionImpl
>;
