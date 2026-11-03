import type { ImessageBridgeConfig } from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class ImessageBridgeService {
  getStatus = async () => {
    return ensureElectronIpc().imessageBridge.getStatus();
  };

  removeConfig = async (applicationId: string) => {
    return ensureElectronIpc().imessageBridge.removeConfig({ applicationId });
  };

  start = async () => {
    return ensureElectronIpc().imessageBridge.start();
  };

  stop = async () => {
    return ensureElectronIpc().imessageBridge.stop();
  };

  testConfig = async (config: ImessageBridgeConfig) => {
    return ensureElectronIpc().imessageBridge.testConfig(config);
  };

  upsertConfig = async (config: ImessageBridgeConfig) => {
    return ensureElectronIpc().imessageBridge.upsertConfig(config);
  };
}

export const imessageBridgeService = new ImessageBridgeService();
