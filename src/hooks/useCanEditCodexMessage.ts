import { isDesktop } from '@lobechat/const';

import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import { selectRuntimeType } from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';

/**
 * Resolves whether a Codex conversation supports edit-and-resend on its selected runtime.
 *
 * Use when:
 * - Showing the user-message Edit action or confirming an open editor.
 *
 * Expects:
 * - The owning agent and, for a captured editor, its topic identity.
 *
 * Returns:
 * - True for executable local Codex or a bound device using the gateway runtime.
 */
export const useCanEditCodexMessage = (agentId?: string, topicId?: string | null): boolean => {
  const { agencyConfig, isPreferenceLoading, workspaceScoped } = useEffectiveAgencyConfig(agentId, {
    topicId,
  });
  const isGatewayMode = useIsGatewayModeEnabled(agentId);
  const isWorkspaceAgent = useAgentStore((s) => !!(agentId && s.agentMap[agentId]?.workspaceId));
  if (!agentId || isPreferenceLoading || agencyConfig?.heterogeneousProvider?.type !== 'codex')
    return false;
  try {
    const runtime = selectRuntimeType({
      boundDeviceId: agencyConfig.boundDeviceId,
      executionTarget: agencyConfig.executionTarget,
      heterogeneousProvider: agencyConfig.heterogeneousProvider,
      isGatewayMode,
      isWorkspaceAgent,
      workspaceScoped,
    });
    if (runtime === 'hetero') return true;

    // Resolve through the same target rules as Send, after its authorization guards.
    return (
      runtime === 'gateway' &&
      !!agencyConfig.boundDeviceId &&
      resolveExecutionTarget(agencyConfig, {
        clientExecutionAvailable: isDesktop,
        isHetero: true,
        workspaceScoped,
      }) === 'device'
    );
  } catch {
    // Invalid effective runtime configurations cannot offer an executable edit action.
    return false;
  }
};
