import { type AgentItem, type LobeAgentConfig } from '@lobechat/types';
import { type SWRResponse } from 'swr';
import { type PartialDeep } from 'type-fest';

import { useOnlyFetchOnceSWR } from '@/libs/swr';
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

  useInitBuiltinAgent = (
    slug: string,
    context?: UseInitBuiltinAgentContext,
  ): SWRResponse<AgentItem | null> => {
    return useOnlyFetchOnceSWR(
      context?.isLogin === false ? null : `initBuiltinAgent:${slug}`,
      async () => {
        const data = await agentService.getBuiltinAgent(slug);

        return data as AgentItem | null;
      },
      {
        onSuccess: (data: AgentItem | null) => {
          if (data?.id) {
            // Update builtinAgentIdMap with the agent id
            // Update agentMap with the agent config
            // AgentItem contains all fields needed for LobeAgentConfig
            this.#get().internal_dispatchAgentMap(data.id, data as PartialDeep<LobeAgentConfig>);

            this.#set(
              { builtinAgentIdMap: { ...this.#get().builtinAgentIdMap, [slug]: data.id } },
              false,
              `useInitBuiltinAgent/${slug}`,
            );
          }
        },
      },
    );
  };
}

export type BuiltinAgentSliceAction = Pick<
  BuiltinAgentSliceActionImpl,
  keyof BuiltinAgentSliceActionImpl
>;
