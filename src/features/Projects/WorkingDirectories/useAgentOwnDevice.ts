import { useMemo } from 'react';

import { getAgentOwnDevice } from '@/helpers/agentOwnDevice';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';

/**
 * The device a heterogeneous agent runs on of its own, for this member — the
 * shared row merged with their device pick, as the send reads it — and for a
 * new conversation, so no topic binding applies. While the member's pick is
 * still `loading`, nothing may be staged or sent automatically: the device
 * could still turn out to be another one, or exist only in that pick.
 */
export const useAgentOwnDevice = (agentId: string | undefined) => {
  const { agencyConfig, isPreferenceLoading } = useEffectiveAgencyConfig(agentId, {
    topicId: null,
  });
  const ownDevice = isPreferenceLoading ? undefined : getAgentOwnDevice(agencyConfig);
  const deviceId = ownDevice?.deviceId;
  const sandboxFallback = ownDevice?.sandboxFallback;
  return useMemo(
    () => ({
      loading: isPreferenceLoading,
      ownDevice: deviceId ? { deviceId, sandboxFallback: !!sandboxFallback } : undefined,
    }),
    [deviceId, isPreferenceLoading, sandboxFallback],
  );
};
