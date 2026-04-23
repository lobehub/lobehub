import type {
  KillProcessParams,
  KillProcessResult,
  ListProcessesParams,
  ListProcessesResult,
  ProcessInfo,
} from '@lobechat/electron-client-ipc';
import type { ProcessRegistryEvent, RegisteredProcess } from '@lobechat/process-registry';
import { app as electronApp } from 'electron';

import { createLogger } from '@/utils/logger';
import { processRegistry } from '@/utils/processRegistry';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:ProcessManagerCtr');

function toInfo(p: RegisteredProcess): ProcessInfo {
  return {
    args: p.args,
    command: p.command,
    exitCode: p.exitCode,
    exitedAt: p.exitedAt,
    ownerModule: p.tags.ownerModule,
    pgid: p.pgid,
    pid: p.pid,
    sessionId: p.tags.sessionId,
    shellId: p.shellId,
    startedAt: p.startedAt,
    status: p.status,
    tags: p.tags,
    toolCallId: p.tags.toolCallId,
    topicId: p.tags.topicId,
  };
}

export default class ProcessManagerCtr extends ControllerModule {
  static override readonly groupName = 'processManager';

  afterAppReady() {
    processRegistry.subscribe((event: ProcessRegistryEvent) => {
      try {
        this.app.browserManager.broadcastToAllWindows('processManagerChanged', {
          process: toInfo(event.process),
          type: event.type,
        });
      } catch (err) {
        logger.warn('Failed to broadcast process event:', err);
      }
    });

    // Detached unix children survive main-process death; explicitly sweep
    // them on normal quit so a user-initiated exit doesn't leak processes.
    electronApp.on('before-quit', () => {
      const running = processRegistry.list({ status: 'running' });
      if (running.length === 0) return;
      logger.info(`Cleaning up ${running.length} tracked processes on quit`);
      processRegistry.cleanupAll('SIGTERM');
    });
  }

  @IpcMethod()
  async listProcesses(params: ListProcessesParams = {}): Promise<ListProcessesResult> {
    const processes = processRegistry.list(params).map(toInfo);
    return { processes };
  }

  @IpcMethod()
  async killProcess(params: KillProcessParams): Promise<KillProcessResult> {
    try {
      const killedShellIds = processRegistry.kill(params);
      logger.info('Killed processes:', { filter: params, killedShellIds });
      return { killedShellIds, success: true };
    } catch (error) {
      const message = (error as Error).message;
      logger.warn('killProcess refused:', message);
      return { error: message, killedShellIds: [], success: false };
    }
  }
}
