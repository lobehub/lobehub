import { ensureElectronIpc } from '@/utils/electron/ipc';

class RendererOtaService {
  bootPing = async (stage?: 'loaded' | 'mounted') => {
    return ensureElectronIpc().rendererOta.bootPing(stage);
  };

  applyNow = async (): Promise<boolean> => {
    return ensureElectronIpc().rendererOta.applyNow();
  };

  getStatus = async () => {
    return ensureElectronIpc().rendererOta.getStatus();
  };
}

export const rendererOtaService = new RendererOtaService();
