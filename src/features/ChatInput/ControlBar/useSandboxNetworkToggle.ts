import { isDesktop } from '@lobechat/const';
import { useCallback } from 'react';

import type { useSelectExecutionTarget } from '@/features/ChatInput/hooks/useSelectExecutionTarget';
import { isLocalSandboxEnabled, resolveExecutionTarget } from '@/helpers/executionTarget';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';

interface UseSandboxNetworkToggleOptions {
  agentId: string;
  deviceRoutingAvailable?: boolean;
  isHetero: boolean;
  selectExecutionTarget: ReturnType<typeof useSelectExecutionTarget>;
}

/**
 * Persist the local-sandbox network flag on top of the agent's UNPINNED default.
 *
 * The picker displays the composer topic's machine, but the save writes the
 * agent/member default for new conversations. Re-sending the topic-bound target
 * (or its sandbox flag) with the flag would silently re-route future topics to
 * this topic's machine, so the rest of the write is resolved with `topicId: null`.
 */
export const useSandboxNetworkToggle = ({
  agentId,
  deviceRoutingAvailable,
  isHetero,
  selectExecutionTarget,
}: UseSandboxNetworkToggleOptions) => {
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId, { topicId: null });
  const defaultTarget = resolveExecutionTarget(agencyConfig, {
    clientExecutionAvailable: isDesktop,
    deviceRoutingAvailable,
    isHetero,
    workspaceScoped,
  });
  const defaultSandbox = isLocalSandboxEnabled(agencyConfig, defaultTarget);
  const defaultBoundDeviceId = agencyConfig?.boundDeviceId;

  return useCallback(
    async (enabled: boolean) => {
      await selectExecutionTarget(defaultTarget, defaultBoundDeviceId, {
        localSandbox: defaultSandbox,
        localSandboxNetwork: enabled,
      });
    },
    [defaultBoundDeviceId, defaultSandbox, defaultTarget, selectExecutionTarget],
  );
};
