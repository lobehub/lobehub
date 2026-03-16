import type {
  GetCommandOutputParams,
  GetCommandOutputResult,
  KillCommandParams,
  KillCommandResult,
  RunCommandParams,
  RunCommandResult,
} from '@lobechat/electron-client-ipc';
import { runCommand, ShellProcessManager } from '@lobechat/local-file-shell';

import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:ShellCommandCtr');

const processManager = new ShellProcessManager();

export default class ShellCommandCtr extends ControllerModule {
  static override readonly groupName = 'shellCommand';

  @IpcMethod()
  async handleRunCommand(params: RunCommandParams): Promise<RunCommandResult> {
    return runCommand(params, { logger, processManager });
  }

  @IpcMethod()
  async handleGetCommandOutput(params: GetCommandOutputParams): Promise<GetCommandOutputResult> {
    return processManager.getOutput(params);
  }

  @IpcMethod()
  async handleKillCommand({ shell_id }: KillCommandParams): Promise<KillCommandResult> {
    return processManager.kill(shell_id);
  }
}
