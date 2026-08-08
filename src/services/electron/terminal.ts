import type {
  TerminalCreateSessionParams,
  TerminalCreateSessionResult,
  TerminalKillParams,
  TerminalResizeParams,
  TerminalWriteParams,
} from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class ElectronTerminalService {
  private get ipc() {
    return ensureElectronIpc();
  }

  createSession(params: TerminalCreateSessionParams): Promise<TerminalCreateSessionResult> {
    return this.ipc.terminal.createSession(params);
  }

  writeSession(params: TerminalWriteParams): Promise<void> {
    return this.ipc.terminal.writeSession(params);
  }

  resizeSession(params: TerminalResizeParams): Promise<void> {
    return this.ipc.terminal.resizeSession(params);
  }

  killSession(params: TerminalKillParams): Promise<void> {
    return this.ipc.terminal.killSession(params);
  }
}

export const electronTerminalService = new ElectronTerminalService();
