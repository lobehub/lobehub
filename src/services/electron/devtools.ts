import { ensureElectronIpc } from '@/utils/electron/ipc';

class DevtoolsService {
  async openDevtools(): Promise<void> {
    return ensureElectronIpc().devtools.openDevtools();
  }
}

export const electronDevtoolsService = new DevtoolsService();
