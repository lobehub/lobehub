import { useDeviceList } from '@/store/device';

import { getBoundDevicePresence } from './boundDevicePresence';
import { resolveDeviceCliState } from './deviceCliStatus';
import { useDeviceAgentScan } from './useDeviceAgentScan';

/**
 * The agent CLI on a bound device, probed over the device gateway.
 *
 * Scans only once the device is known to be online. Redetect re-scans an
 * online device and re-checks presence otherwise, since an offline device
 * cannot answer a scan.
 */
export const useDeviceCliStatus = ({
  agentType,
  deviceId,
}: {
  agentType: string;
  deviceId: string;
}) => {
  const {
    data: devices,
    isConfirmed,
    isValidating: isRefreshingDevices,
    mutate: refreshDevices,
  } = useDeviceList();
  const device = devices?.find((item) => item.deviceId === deviceId);
  const presence = getBoundDevicePresence(deviceId, device, isConfirmed);
  const scan = useDeviceAgentScan(presence === 'online' ? deviceId : undefined);

  const redetect = () => {
    void (presence === 'online' ? scan.mutate() : refreshDevices());
  };

  return {
    device,
    isRedetecting: scan.isValidating || isRefreshingDevices,
    redetect,
    state: resolveDeviceCliState({
      agentType,
      presence,
      scan: scan.data,
      scanError: scan.error,
    }),
  };
};
