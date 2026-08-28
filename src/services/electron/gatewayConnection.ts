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

  getDeviceInfo = async () => {
    return ensureElectronIpc().gatewayConnection.getDeviceInfo();
  };
}

export const gatewayConnectionService = new GatewayConnectionService();
