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

  setDeviceDescription = async (description: string) => {
    return ensureElectronIpc().gatewayConnection.setDeviceDescription({ description });
  };

  setDeviceName = async (name: string) => {
    return ensureElectronIpc().gatewayConnection.setDeviceName({ name });
  };
}

export const gatewayConnectionService = new GatewayConnectionService();
