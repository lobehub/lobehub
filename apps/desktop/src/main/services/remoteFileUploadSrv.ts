import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

import RemoteServerConfigCtr from '@/controllers/RemoteServerConfigCtr';
import { resolveCliScript } from '@/modules/cliEmbedding';
import { buildProxyEnv } from '@/modules/networkProxy/envBuilder';
import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

const logger = createLogger('services:RemoteFileUploadService');

const UPLOAD_TIMEOUT_MS = 60_000;
const UPLOAD_MAX_ATTEMPTS = 3;
const UPLOAD_RETRY_BASE_DELAY_MS = 300;

export interface UploadedFileRecord {
  id: string;
  url: string;
}

export type UploadFailureKind = 'auth' | 'network' | 'storage_quota' | 'unknown';

export interface UploadFailure {
  kind: UploadFailureKind;
  /** The CLI's own error line, e.g. `storage_block:upgrade_required`. */
  reason: string;
}

const MAX_REASON_LENGTH = 300;

const NETWORK_ERROR_PATTERN =
  /fetch failed|network|socket hang up|timed? ?out|econnreset|econnrefused|etimedout|enotfound|eai_again|epipe|und_err|upload failed: 5\d\d/i;
const AUTH_ERROR_PATTERN = /unauthori[sz]ed|no authentication|not logged in|\blogin\b|\b401\b/i;

/**
 * Reduce a failed `lh file upload` run to a reason the model can act on. The
 * CLI prints `[ERROR] <message>` on stderr and exits 1; `execFile` folds that
 * into `Command failed: <cmd>\n<stderr>`.
 */
export const describeUploadFailure = (error: unknown): UploadFailure => {
  const raw = error as { killed?: boolean; message?: string; signal?: string; stderr?: string };

  if (raw?.killed && raw.signal) {
    return { kind: 'network', reason: `upload timed out after ${UPLOAD_TIMEOUT_MS / 1000}s` };
  }

  const text = [raw?.stderr, raw?.message ?? String(error)].filter(Boolean).join('\n');
  // eslint-disable-next-line no-control-regex
  const lines = text.replaceAll(/\u001B\[[\d;]*m/g, '').split('\n');
  const errorLine = lines
    .map((line) => line.trim())
    .findLast((line) => line && !line.startsWith('Command failed:'));
  const reason = (errorLine?.replace(/^.*?\[ERROR\]\s*/, '') || 'unknown error').slice(
    0,
    MAX_REASON_LENGTH,
  );

  const storageBlock = text.match(/storage_block:[\w-]+/);
  if (storageBlock) return { kind: 'storage_quota', reason: storageBlock[0] };
  if (AUTH_ERROR_PATTERN.test(text)) return { kind: 'auth', reason };
  if (NETWORK_ERROR_PATTERN.test(text)) return { kind: 'network', reason };

  return { kind: 'unknown', reason };
};

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
    // The in-app proxy only covers the main process's undici dispatcher; the
    // CLI child needs it as env, plus env-proxy mode so its fetch honours it.
    const proxyEnv = buildProxyEnv(this.app.storeManager.get('networkProxy'));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...proxyEnv,
      ...(Object.keys(proxyEnv).length > 0 && { NODE_USE_ENV_PROXY: '1' }),
      ELECTRON_RUN_AS_NODE: '1',
    };

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

    const stdout = await this.runUploadWithRetry(filePath, env);

    const record = JSON.parse(stdout.trim()) as Partial<UploadedFileRecord>;
    if (!record?.id || !record.url) {
      logger.warn('CLI upload returned no file record:', { filePath, stdout });
      return undefined;
    }

    return { id: record.id, url: record.url };
  }

  /**
   * Retry only transient network failures (a flaky PUT to object storage);
   * quota, auth and validation rejections fail the same way every time.
   */
  private async runUploadWithRetry(filePath: string, env: NodeJS.ProcessEnv): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      try {
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [resolveCliScript(), 'file', 'upload', filePath, '--json', 'id,url'],
          { env, timeout: UPLOAD_TIMEOUT_MS },
        );
        return stdout;
      } catch (error) {
        const failure = describeUploadFailure(error);
        if (failure.kind !== 'network' || attempt >= UPLOAD_MAX_ATTEMPTS) throw error;

        logger.warn('Image upload failed, retrying:', {
          attempt,
          filePath,
          reason: failure.reason,
        });
        await new Promise((resolve) => setTimeout(resolve, UPLOAD_RETRY_BASE_DELAY_MS * attempt));
      }
    }
  }
}
