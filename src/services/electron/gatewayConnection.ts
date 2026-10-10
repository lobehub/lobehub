import { ensureElectronIpc } from '@/utils/electron/ipc';

class GatewayConnectionService {
  connect = async () => {
    return ensureElectronIpc().gatewayConnection.connect();
  };

  disconnect = async () => {
    return ensureElectronIpc().gatewayConnection.disconnect();
  };

  getConnectionStatus = async () => {
    return ensureElectronIpc().gatewayConnection.getConnectionStatus();
  };

  getKeepAwake = async () => {
    return ensureElectronIpc().gatewayConnection.getKeepAwake();
  };

  setKeepAwake = async (enabled: boolean) => {
    return ensureElectronIpc().gatewayConnection.setKeepAwake({ enabled });
  };

  getDeviceInfo = async () => {
    return ensureElectronIpc().gatewayConnection.getDeviceInfo();
  };

  getGatewayEndpoint = async () => {
    return ensureElectronIpc().gatewayConnection.getGatewayEndpoint();
  };

  /** Save (or clear, with `null`) the gateway address in settings. */
  setGatewayManualUrl = async (url: string | null) => {
    return ensureElectronIpc().gatewayConnection.setGatewayManualUrl({ url });
  };
}

export const gatewayConnectionService = new GatewayConnectionService();
