import type {
  KillProcessParams,
  KillProcessResult,
  ListProcessesParams,
  ListProcessesResult,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class ProcessManagerService {
  async listProcesses(params: ListProcessesParams = {}): Promise<ListProcessesResult> {
    return ensureElectronIpc().processManager.listProcesses(params);
  }

  async killProcess(params: KillProcessParams): Promise<KillProcessResult> {
    return ensureElectronIpc().processManager.killProcess(params);
  }
}

export const processManagerService = new ProcessManagerService();
