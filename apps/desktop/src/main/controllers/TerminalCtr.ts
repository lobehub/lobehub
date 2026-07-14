import type {
  TerminalCreateSessionParams,
  TerminalCreateSessionResult,
  TerminalKillParams,
  TerminalResizeParams,
  TerminalWriteParams,
} from '@lobechat/electron-client-ipc';
import { app as electronApp, BrowserWindow } from 'electron';

import { PtySessionManager } from '@/modules/terminal';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:TerminalCtr');

/** Coalesce PTY output for this long before broadcasting, so a flood of small
 * chunks (e.g. `yarn build`) doesn't turn into thousands of IPC messages. */
const FLUSH_INTERVAL_MS = 8;

export default class TerminalCtr extends ControllerModule {
  static override readonly groupName = 'terminal';

  private manager = new PtySessionManager({
    onData: (id, data) => this.queueData(id, data),
    onExit: (id, exitCode) => {
      this.flush();
      logger.debug(`session ${id} exited with code ${exitCode}`);
      this.broadcast('terminalExit', { exitCode, id });
    },
  });

  private pendingData = new Map<string, string>();
  private flushTimer: NodeJS.Timeout | null = null;

  @IpcMethod()
  async createSession(params: TerminalCreateSessionParams): Promise<TerminalCreateSessionResult> {
    const info = this.manager.create(params);
    logger.debug(`created session ${info.id} (pid ${info.pid}, shell ${info.shell})`);
    return info;
  }

  @IpcMethod()
  async writeSession(params: TerminalWriteParams): Promise<void> {
    this.manager.write(params.id, params.data);
  }

  @IpcMethod()
  async resizeSession(params: TerminalResizeParams): Promise<void> {
    this.manager.resize(params.id, params.cols, params.rows);
  }

  @IpcMethod()
  async killSession(params: TerminalKillParams): Promise<void> {
    logger.debug(`killing session ${params.id}`);
    this.manager.kill(params.id);
  }

  afterAppReady() {
    electronApp.on('before-quit', () => {
      this.manager.killAll();
    });
  }

  private queueData(id: string, data: string) {
    this.pendingData.set(id, (this.pendingData.get(id) ?? '') + data);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  private flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingData.size === 0) return;
    const batch = this.pendingData;
    this.pendingData = new Map();
    for (const [id, data] of batch) {
      this.broadcast('terminalData', { data, id });
    }
  }

  private broadcast<T>(channel: string, data: T) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  }
}
