import { type AgentItem, type LobeAgentConfig } from '@lobechat/types';
import { type SWRResponse } from 'swr';
import type { PartialDeep } from 'type-fest';
import { type StateCreator } from 'zustand/vanilla';

import { useOnlyFetchOnceSWR } from '@/libs/swr';
import { agentService } from '@/services/agent';

import type { AgentStore } from '../../store';

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
export interface BuiltinAgentSliceAction {
  /**
   * Generic hook to initialize a builtin agent by slug.
   * Fetches the builtin agent (creating it if it doesn't exist)
   *
   * @param slug - The builtin agent slug (e.g., 'page-agent', 'inbox')
   * @param context - Optional context with isLogin flag
   */
  useInitBuiltinAgent: (
    slug: string,
    context?: UseInitBuiltinAgentContext,
  ) => SWRResponse<AgentItem | null>;
}

export const createBuiltinAgentSlice: StateCreator<
  AgentStore,
  [['zustand/devtools', never]],
  [],
  BuiltinAgentSliceAction
> = (set, get) => ({
  useInitBuiltinAgent: (slug, context) =>
    useOnlyFetchOnceSWR(
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
            get().internal_dispatchAgentMap(data.id, data as PartialDeep<LobeAgentConfig>);

            set(
              { builtinAgentIdMap: { ...get().builtinAgentIdMap, [slug]: data.id } },
              false,
              `useInitBuiltinAgent/${slug}`,
            );
          }
        },
      },
    ),
});
