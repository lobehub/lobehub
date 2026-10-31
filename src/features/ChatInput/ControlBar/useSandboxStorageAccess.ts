import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { isDesktop } from '@lobechat/const';

import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { sandboxActions, sandboxSelectors, useSandboxStore } from '@/store/sandbox';

import { useTopicId } from '../hooks/useTopicId';

/**
 * What the composer should show where the sandbox working directory goes:
 *
 * - `hidden`  — the run does not use the cloud sandbox, or the deployment has
 *   no drive service at all (self-hosted). Nothing is rendered.
 * - `upgrade` — this account has no persistent workspace.
 * - `ready`   — entitled.
 */
export type SandboxStorageAccess = 'hidden' | 'ready' | 'upgrade';

export interface SandboxStorageAccessResult {
  /** Soft storage quota of the workspace, once known. */
  quotaBytes: number | null;
  status: SandboxStorageAccess;
}

/**
 * Whether this agent's runs touch the cloud sandbox at all. A run bound to a
 * device or the local machine has its own working directory and its own picker;
 * showing a second one for a sandbox it never starts would be noise at best and
 * a lie about where files land at worst.
 */
const useRunsInSandbox = (agentId: string): boolean => {
  const isHetero = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  const topicId = useTopicId();
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId, { topicId });
  const deviceRoutingAvailable = useIsGatewayModeEnabled(agentId);

  return (
    resolveExecutionTarget(agencyConfig, {
      clientExecutionAvailable: isDesktop,
      deviceRoutingAvailable,
      isHetero,
      workspaceScoped,
    }) === 'sandbox'
  );
};

/**
 * The entitlement is deliberately NOT derived on the client from a plan: it is
 * resolved and signed server-side, and asking the server is the only way to see
 * the same answer the sandbox will act on. Only a deployment with business
 * features has a drive to ask about; anywhere else nobody is entitled, and an
 * upgrade prompt would point at plans that do not exist.
 */
export const useSandboxStorageAccess = (agentId: string): SandboxStorageAccessResult => {
  const runsInSandbox = useRunsInSandbox(agentId);
  const shouldAsk = ENABLE_BUSINESS_FEATURES && runsInSandbox;

  // A replica partitioned by the cache scope (user + workspace), because the
  // server resolves the entitlement from the active workspace: one workspace's
  // answer and quota never reach the next. Persisted, so a reload paints the
  // chip from the last answer while this one is confirmed; the server still
  // checks the claim on every sandbox call.
  sandboxActions.useFetchEntitlement(shouldAsk, { revalidateOnFocus: false });
  const data = useSandboxStore(sandboxSelectors.entitlement);

  if (!shouldAsk) return { quotaBytes: null, status: 'hidden' };
  // Until the answer arrives, show nothing rather than flashing an upgrade
  // prompt at a user who turns out to be entitled.
  if (!data) return { quotaBytes: null, status: 'hidden' };

  return {
    quotaBytes: data.quotaBytes,
    status: data.entitled ? 'ready' : 'upgrade',
  };
};
