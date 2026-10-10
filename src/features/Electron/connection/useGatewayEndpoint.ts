import { isDesktop } from '@lobechat/const';
import useSWR from 'swr';

import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';

const SWR_KEY = 'desktop-gateway-endpoint';

/**
 * The Device Gateway this desktop login uses and the fallback address saved
 * for a self-hosted server, as resolved by the main process. Re-read on every
 * connection status change, since each new attempt resolves it again.
 */
export const useGatewayEndpoint = () => {
  const isSyncActive = useElectronStore(electronSyncSelectors.isSyncActive);
  const status = useElectronStore((s) => s.gatewayConnectionStatus);

  return useSWR(
    isDesktop && isSyncActive ? [SWR_KEY, status] : null,
    () => gatewayConnectionService.getGatewayEndpoint(),
    { keepPreviousData: true, revalidateOnFocus: false },
  );
};
