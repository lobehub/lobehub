import type {
  DesktopShellSettings,
  GetCommandOutputParams,
  GetCommandOutputResult,
  KillCommandParams,
  KillCommandResult,
  RunCommandParams,
  RunCommandResult,
  SetShellModeParams,
} from '@lobechat/electron-client-ipc';
import {
  findGitBash,
  getShellInfo,
  runCommand,
  setWindowsShellPreference,
  ShellProcessManager,
} from '@lobechat/local-file-shell';

import { createLogger } from '@/utils/logger';

import CliCtr from './CliCtr';
import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:ShellCommandCtr');

const processManager = new ShellProcessManager();

/** Prefix for a simple `lh`/`lobe`/`lobehub` invocation (keyword + boundary, args via slice). */
const SIMPLE_LH_PREFIX = /^\s*(?:lh|lobe|lobehub)(?=\s|$)/;

export default class ShellCommandCtr extends ControllerModule {
  static override readonly groupName = 'shellCommand';

  /**
   * Apply the persisted Windows shell preference before any command runs, so
   * the local-file-shell detection chain honors it from the first execution.
   */
  beforeAppReady() {
    if (process.platform !== 'win32') return;
    const mode = this.app.storeManager.get('windowsShellMode', 'auto');
    setWindowsShellPreference(mode);
    logger.debug('Applied Windows shell preference:', mode);
  }

  @IpcMethod()
  async getShellSettings(): Promise<DesktopShellSettings> {
    const gitBashPath = process.platform === 'win32' ? await findGitBash() : undefined;
    const { displayName, path } = await getShellInfo();

    return {
      currentShell: { displayName, path },
      gitBashAvailable: !!gitBashPath,
      gitBashPath,
      mode: this.app.storeManager.get('windowsShellMode', 'auto'),
    };
  }

  @IpcMethod()
  async setShellMode({ mode }: SetShellModeParams): Promise<DesktopShellSettings> {
    if (mode === 'gitbash' && !(await findGitBash())) {
      throw new Error('Git Bash is not installed');
    }

    this.app.storeManager.set('windowsShellMode', mode);
    setWindowsShellPreference(mode);
    logger.info('Windows shell mode updated:', mode);

    return this.getShellSettings();
  }

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
