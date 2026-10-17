import type { CoreUpdateStatus } from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class RendererOtaService {
  bootPing = async (stage?: 'loaded' | 'mounted') => {
    return ensureElectronIpc().rendererOta.bootPing(stage);
  };

  applyNow = async (): Promise<boolean> => {
    return ensureElectronIpc().rendererOta.applyNow();
  };

  resolveUnloadConfirmation = async (proceed: boolean) => {
    return ensureElectronIpc().rendererOta.resolveUnloadConfirmation(proceed);
  };

  getStatus = async (): Promise<CoreUpdateStatus> => {
    return ensureElectronIpc().rendererOta.getStatus();
  };
}

export const rendererOtaService = new RendererOtaService();
