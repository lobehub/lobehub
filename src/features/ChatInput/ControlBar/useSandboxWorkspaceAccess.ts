import { isDesktop } from '@lobechat/const';
import useSWR from 'swr';

import { resolveExecutionTarget } from '@/helpers/executionTarget';
import { useIsGatewayModeEnabled } from '@/helpers/gatewayMode';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { sandboxWorkspaceService } from '@/services/sandboxWorkspace';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useUserStore } from '@/store/user';
import { labPreferSelectors } from '@/store/user/selectors';

/**
 * What the composer should show where the sandbox working directory goes:
 *
 * - `hidden`  — the run does not use the cloud sandbox, or the user has not
 *   opted into the experiment. Nothing is rendered; a switch the user never
 *   flipped should not start advertising itself in their composer.
 * - `upgrade` — opted in, but this account has no persistent workspace.
 * - `ready`   — opted in and entitled.
 */
export type SandboxWorkspaceAccess = 'hidden' | 'ready' | 'upgrade';

export interface SandboxWorkspaceAccessResult {
  /** Soft storage quota of the workspace, once known. */
  quotaBytes: number | null;
  status: SandboxWorkspaceAccess;
}

/**
 * Whether this agent's runs touch the cloud sandbox at all. A run bound to a
 * device or the local machine has its own working directory and its own picker;
 * showing a second one for a sandbox it never starts would be noise at best and
 * a lie about where files land at worst.
 */
const useRunsInSandbox = (agentId: string): boolean => {
  const isHetero = useAgentStore(agentByIdSelectors.isAgentHeterogeneousById(agentId));
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId);
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
 * the same answer the sandbox will act on. The lab flag is the cheap local half,
 * so the request is not made at all until the user has opted in.
 */
export const useSandboxWorkspaceAccess = (agentId: string): SandboxWorkspaceAccessResult => {
  const labEnabled = useUserStore(labPreferSelectors.enablePersistentSandbox);
  const runsInSandbox = useRunsInSandbox(agentId);
  const shouldAsk = labEnabled && runsInSandbox;

  const { data } = useSWR(
    shouldAsk ? 'sandbox-workspace-entitlement' : null,
    () => sandboxWorkspaceService.getEntitlement(),
    { revalidateOnFocus: false },
  );

  if (!shouldAsk) return { quotaBytes: null, status: 'hidden' };
  // Until the answer arrives, show nothing rather than flashing an upgrade
  // prompt at a user who turns out to be entitled.
  if (!data) return { quotaBytes: null, status: 'hidden' };

  return {
    quotaBytes: data.quotaBytes,
    status: data.entitled ? 'ready' : 'upgrade',
  };
};
