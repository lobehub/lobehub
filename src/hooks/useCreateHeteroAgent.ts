import { type HeterogeneousAgentClientConfig } from '@lobechat/heterogeneous-agents/client';
import { useCallback } from 'react';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { useHomeStore } from '@/store/home';

export interface CreateHeteroAgentOptions {
  groupId?: string;
  onSuccess?: () => void;
}

/**
 * Create a heterogeneous agent (CLI-backed: Claude Code, Codex, …) and navigate
 * straight to the chat page. Skips the standard /profile redirect because the
 * external CLI runtime has a fixed config — there's nothing to edit upfront.
 */
export const useCreateHeteroAgent = () => {
  const storeCreateAgent = useAgentStore((s) => s.createAgent);
  const refreshAgentList = useHomeStore((s) => s.refreshAgentList);
  const navigate = useWorkspaceAwareNavigate();

  return useCallback(
    async (definition: HeterogeneousAgentClientConfig, options?: CreateHeteroAgentOptions) => {
      const result = await storeCreateAgent({
        config: {
          agencyConfig: {
            heterogeneousProvider: {
              command: definition.command,
              type: definition.type,
            },
          },
          avatar: definition.avatar,
          systemRole: '',
          title: definition.title,
        },
        groupId: options?.groupId,
      });
      await refreshAgentList();
      navigate(`/agent/${result.agentId}`);
      options?.onSuccess?.();
    },
    [storeCreateAgent, refreshAgentList, navigate],
  );
};
