import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

/**
 * The device an agent's author fixed it to. Read from the shared row, as the
 * composer's device switcher does: it is what the server checks a run in a
 * project directory against. `null` for an agent fixed to a target that is not
 * a device (no `boundDeviceId` to match), `undefined` when it is not fixed or
 * not loaded.
 */
export const useAgentFixedDeviceId = (agentId: string | undefined) =>
  useAgentStore((s) => {
    if (!agentId) return undefined;
    const agencyConfig = agentByIdSelectors.getAgencyConfigById(agentId)(s);
    return agencyConfig?.executionTargetSelectionPolicy === 'fixed'
      ? (agencyConfig.boundDeviceId ?? null)
      : undefined;
  });
