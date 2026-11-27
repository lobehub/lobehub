import { useMemo } from 'react';

import { getAgentOwnDevice } from '@/helpers/agentOwnDevice';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';

/**
 * The device a heterogeneous agent runs on of its own, for this member — the
 * shared row merged with their device pick, as the send reads it — and for a
 * new conversation, so no topic binding applies. `undefined` while the
 * member's pick is still loading, so a draft is not staged on a device that
 * may flip.
 */
export const useAgentOwnDevice = (agentId: string | undefined) => {
  const { agencyConfig, isPreferenceLoading } = useEffectiveAgencyConfig(agentId, {
    topicId: null,
  });
  const ownDevice = isPreferenceLoading ? undefined : getAgentOwnDevice(agencyConfig);
  const deviceId = ownDevice?.deviceId;
  const sandboxFallback = ownDevice?.sandboxFallback;
  return useMemo(
    () => (deviceId ? { deviceId, sandboxFallback: !!sandboxFallback } : undefined),
    [deviceId, sandboxFallback],
  );
};
