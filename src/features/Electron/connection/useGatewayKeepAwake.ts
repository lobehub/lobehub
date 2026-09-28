import { useCallback } from 'react';
import useSWR from 'swr';

import { gatewayConnectionService } from '@/services/electron/gatewayConnection';

const SWR_KEY = 'desktop-gateway-keep-awake';

/**
 * Whether this computer is kept from idle-sleeping while its device gateway
 * connection is enabled. Persisted in the desktop main-process store.
 */
export const useGatewayKeepAwake = () => {
  const { data, isLoading, mutate } = useSWR(
    SWR_KEY,
    async () => (await gatewayConnectionService.getKeepAwake()).enabled,
    { revalidateOnFocus: false },
  );

  const setKeepAwake = useCallback(
    async (enabled: boolean) => {
      await mutate(async () => (await gatewayConnectionService.setKeepAwake(enabled)).enabled, {
        optimisticData: enabled,
        revalidate: false,
        rollbackOnError: true,
      });
    },
    [mutate],
  );

  return { enabled: data, isLoading, setKeepAwake };
};
