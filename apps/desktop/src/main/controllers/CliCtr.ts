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

  @IpcMethod()
  async runCliCommand(args: string): Promise<{ exitCode: number; stderr: string; stdout: string }> {
    const execAsync = promisify(exec);
    const wrapperDir = getCliWrapperDir();
    const cmd = process.platform === 'win32' ? 'lobehub.cmd' : 'lobehub';
    const wrapperPath = path.join(wrapperDir, cmd);

    const env = { ...process.env };

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
