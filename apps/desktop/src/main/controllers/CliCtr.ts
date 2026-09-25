import { exec } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { getCliWrapperDir } from '@/modules/cliEmbedding';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';

const logger = createLogger('controllers:CliCtr');

function normalizeServerUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export default class CliCtr extends ControllerModule {
  static override readonly groupName = 'cli';

  /**
   * Environment for running the embedded CLI: the caller's own variables, the
   * wrapper directory first on `PATH` (so `lh` / `lobe` / `lobehub` resolve to
   * the bundled CLI rather than whatever else is installed), and — when the
   * app is signed in — the credentials the CLI authenticates with.
   *
   * Returned as overrides layered on top of `process.env` by the runner.
   */
  async buildCliEnv(baseEnv: Record<string, string> = {}): Promise<Record<string, string>> {
    const env: Record<string, string> = { ...baseEnv };

    // Windows spells it `Path`, and a second, differently-cased key next to it
    // would leave which one the child sees up to chance — reuse the existing key.
    const pathKey =
      Object.keys(baseEnv).find((key) => key.toUpperCase() === 'PATH') ??
      Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ??
      'PATH';
    const currentPath = baseEnv[pathKey] ?? process.env[pathKey];
    env[pathKey] = currentPath
      ? `${getCliWrapperDir()}${path.delimiter}${currentPath}`
      : getCliWrapperDir();

    const remoteCtr = this.app.getController(RemoteServerConfigCtr);
    if (remoteCtr) {
      const [token, serverUrl] = await Promise.all([
        remoteCtr.getAccessToken(),
        remoteCtr.getRemoteServerUrl(),
      ]);

      if (token && serverUrl) {
        env.LOBEHUB_JWT = token;
        env.LOBEHUB_SERVER = normalizeServerUrl(serverUrl);
        logger.debug('Injected LOBEHUB_JWT / LOBEHUB_SERVER for CLI command');
      }
    }

    return env;
  }

  /**
   * Quick CLI invocation for the settings page's "test CLI" box. Agent
   * `runCommand` calls do not come through here — they run in the regular
   * command runner (see `ShellCommandCtr.handleRunCommand`).
   */
  @IpcMethod()
  async runCliCommand(args: string): Promise<{ exitCode: number; stderr: string; stdout: string }> {
    const execAsync = promisify(exec);
    const wrapperDir = getCliWrapperDir();
    const cmd = process.platform === 'win32' ? 'lobehub.cmd' : 'lobehub';
    const wrapperPath = path.join(wrapperDir, cmd);

    const env = { ...process.env, ...(await this.buildCliEnv()) };

    try {
      const { stdout, stderr } = await execAsync(`"${wrapperPath}" ${args}`, {
        env,
        timeout: 15_000,
      });
      return { exitCode: 0, stderr, stdout };
    } catch (error: any) {
      return {
        exitCode: error.code ?? 1,
        stderr: error.stderr ?? '',
        stdout: error.stdout ?? String(error.message),
      };
    }
  }
}
