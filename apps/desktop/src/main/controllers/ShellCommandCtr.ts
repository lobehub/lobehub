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

import CliCtr from './CliCtr';
import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:ShellCommandCtr');

const processManager = new ShellProcessManager();

/** Prefix for a simple `lh`/`lobe`/`lobehub` invocation (keyword + boundary, args via slice). */
const SIMPLE_LH_PREFIX = /^\s*(?:lh|lobe|lobehub)(?=\s|$)/;

export default class ShellCommandCtr extends ControllerModule {
  static override readonly groupName = 'shellCommand';

  @IpcMethod()
  async handleRunCommand(params: RunCommandParams): Promise<RunCommandResult> {
    const prefixMatch = SIMPLE_LH_PREFIX.exec(params.command);
    if (prefixMatch) {
      const cliCtr = this.app.getController(CliCtr);
      if (cliCtr) {
        const args = params.command.slice(prefixMatch[0].length).trim();
        logger.debug('Routing lh command to CliCtr.runCliCommand:', args);
        const result = await cliCtr.runCliCommand(args);
        return {
          exit_code: result.exitCode,
          output: result.stdout + result.stderr,
          stderr: result.stderr,
          stdout: result.stdout,
          success: result.exitCode === 0,
        };
      }
    }

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
