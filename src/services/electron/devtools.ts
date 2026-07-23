import { ensureElectronIpc } from '@/utils/electron/ipc';

class DevtoolsService {
  async openDevtools(): Promise<void> {
    return ensureElectronIpc().devtools.openDevtools();
  }

  async getAppCpuUsage(): Promise<{ percent: number }> {
    return ensureElectronIpc().devtools.getAppCpuUsage();
  }
}

export const electronDevtoolsService = new DevtoolsService();
