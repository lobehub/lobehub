import { useCallback, useEffect } from 'react';
import useSWR from 'swr';

import { shareKeys } from '@/libs/swr/keys';
import type { AgentShareConfigInput } from '@/server/routers/lambda/agentShare';
import { agentShareService } from '@/services/agentShare';

export type AgentShareVisibility = 'link' | 'private';

/**
 * Creator-side share state for one agent. Mirrors the topic SharePopover data
 * flow: fetch the share row, and auto-create a `private` record the first time
 * the UI opens — a private row is inert (visitors are refused), so creation has
 * no exposure side effect and lets every control below assume the row exists.
 */
export const useAgentShare = (agentId: string | undefined, enabled: boolean) => {
  const {
    data: shareInfo,
    isLoading,
    mutate,
  } = useSWR(
    enabled && agentId ? shareKeys.agentShareStatus(agentId) : null,
    () => agentShareService.getShareStatus(agentId!),
    { revalidateOnFocus: false },
  );

  useEffect(() => {
    if (enabled && !isLoading && !shareInfo && agentId) {
      agentShareService.enableShare(agentId).then(() => mutate());
    }
  }, [enabled, isLoading, shareInfo, agentId, mutate]);

  const updateVisibility = useCallback(
    async (visibility: AgentShareVisibility) => {
      if (!agentId) return;
      await agentShareService.updateVisibility(agentId, visibility);
      await mutate();
    },
    [agentId, mutate],
  );

  // `updateShareConfig` replaces the whole config (`.strict()` schema), so
  // merge each patch over the server-normalized config before submitting.
  const updateConfig = useCallback(
    async (patch: Partial<AgentShareConfigInput>) => {
      if (!agentId || !shareInfo?.shareConfig) return;
      await agentShareService.updateShareConfig(agentId, {
        ...shareInfo.shareConfig,
        ...patch,
      });
      await mutate();
    },
    [agentId, shareInfo?.shareConfig, mutate],
  );

  return { isLoading, mutate, shareInfo, updateConfig, updateVisibility };
};
