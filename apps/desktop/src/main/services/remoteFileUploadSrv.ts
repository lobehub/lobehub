import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

import RemoteServerConfigCtr from '@/controllers/RemoteServerConfigCtr';
import { resolveCliScript } from '@/modules/cliEmbedding';
import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

const logger = createLogger('services:RemoteFileUploadService');

const UPLOAD_TIMEOUT_MS = 60_000;

export interface UploadedFileRecord {
  id: string;
  url: string;
}

/**
 * Upload local files to the server's file storage from the MAIN process by
 * delegating to the embedded CLI — `lh file upload <path> --json` already
 * implements the whole flow (hash dedup, pre-signed S3 PUT, file record).
 *
 * Runs the CLI script with the app's own binary via `ELECTRON_RUN_AS_NODE=1`
 * (what the generated `lobehub` shell wrapper does), so nothing is spawned
 * through a shell and no PATH install is required. The desktop session is
 * injected via `LOBEHUB_JWT` / `LOBEHUB_SERVER` (same convention as CliCtr
 * and the hetero spawn paths); without one, `lh` falls back to its own
 * stored login.
 */
export default class RemoteFileUploadService extends ServiceModule {
  async uploadLocalFile(filePath: string): Promise<UploadedFileRecord | undefined> {
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };

    const remoteCtr = this.app.getController(RemoteServerConfigCtr);
    if (remoteCtr) {
      const [token, serverUrl] = await Promise.all([
        remoteCtr.getAccessToken(),
        remoteCtr.getRemoteServerUrl(),
      ]);
      if (token && serverUrl) {
        env.LOBEHUB_JWT = token;
        env.LOBEHUB_SERVER = serverUrl.replace(/\/$/, '');
      }
    }

    const { stdout } = await promisify(execFile)(
      process.execPath,
      [resolveCliScript(), 'file', 'upload', filePath, '--json', 'id,url'],
      { env, timeout: UPLOAD_TIMEOUT_MS },
    );

    const record = JSON.parse(stdout.trim()) as Partial<UploadedFileRecord>;
    if (!record?.id || !record.url) {
      logger.warn('CLI upload returned no file record:', { filePath, stdout });
      return undefined;
    }

    return { id: record.id, url: record.url };
  }
}
