import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

import RemoteServerConfigCtr from '@/controllers/RemoteServerConfigCtr';
import { resolveCliScript } from '@/modules/cliEmbedding';
import { buildProxyEnv } from '@/modules/networkProxy/envBuilder';
import { type SocksHttpBridge, startSocksHttpBridge } from '@/modules/networkProxy/socksHttpBridge';
import { createLogger } from '@/utils/logger';

import { ServiceModule } from './index';

const logger = createLogger('services:RemoteFileUploadService');

/**
 * Budget for the whole upload, retries included. readFile runs under a 30s
 * client deadline; the upload must settle before it so the model gets the
 * degraded `[Image: …] (upload unavailable — …)` result rather than a
 * `client_executor_timeout`. `execFile` kills the child when its share runs
 * out, so nothing keeps uploading after the tool call has returned.
 */
const UPLOAD_DEADLINE_MS = 25_000;
const UPLOAD_MAX_ATTEMPTS = 3;
const UPLOAD_RETRY_BASE_DELAY_MS = 300;
/** Not worth starting an attempt with less time than this left. */
const UPLOAD_MIN_ATTEMPT_MS = 5000;

/**
 * Proxy variables Node's env-proxy mode reads. Lowercase takes precedence
 * (`http_proxy || HTTP_PROXY`), so both cases must be set — or cleared — for
 * the in-app proxy to win over whatever the desktop process inherited.
 */
const PROXY_ENV_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'] as const;

const withProxyEnv = (
  base: NodeJS.ProcessEnv,
  proxyEnv: Record<string, string>,
): NodeJS.ProcessEnv => {
  if (Object.keys(proxyEnv).length === 0) return { ...base };

  const env: NodeJS.ProcessEnv = { ...base, NODE_USE_ENV_PROXY: '1' };
  for (const key of PROXY_ENV_KEYS) {
    const value = proxyEnv[key];
    for (const name of [key, key.toLowerCase()]) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
  }
  return env;
};

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

const COMMAND_LINE_PREFIX = 'Command failed:';

/**
 * Absolute paths (the uploaded file echoed back in e.g. `File not found: …`)
 * are data, not error text — `/tmp/network-diagram.png` is not a network error.
 */
const PATH_TOKEN_PATTERN = /(?<=^|[\s"'(:=])(?:~|[a-z]:)?[/\\][^\s"')]*/gi;

/**
 * Reduce a failed `lh file upload` run to a reason the model can act on. The
 * CLI prints `[ERROR] <message>` on stderr and exits 1; `execFile` folds that
 * into `Command failed: <cmd>\n<stderr>`. Only the CLI's own error line (and
 * the errno code, if any) is classified — never the command line, which
 * carries the file path.
 */
export const describeUploadFailure = (error: unknown): UploadFailure => {
  const raw = error as {
    code?: number | string;
    killed?: boolean;
    message?: string;
    signal?: string;
    stderr?: string;
  };

  if (raw?.killed && raw.signal) {
    return { kind: 'network', reason: 'upload timed out' };
  }

  const output = raw?.stderr?.trim() ? raw.stderr : (raw?.message ?? String(error));
  const errorLine = output
    // eslint-disable-next-line no-control-regex
    .replaceAll(/\u001B\[[\d;]*m/g, '')
    .split('\n')
    .map((line) => line.trim())
    .findLast((line) => line && !line.startsWith(COMMAND_LINE_PREFIX));
  const reason = (errorLine?.replace(/^.*?\[ERROR\]\s*/, '') || 'unknown error').slice(
    0,
    MAX_REASON_LENGTH,
  );

  const classifiable = [
    reason.replaceAll(PATH_TOKEN_PATTERN, ''),
    typeof raw?.code === 'string' ? raw.code : '',
  ].join(' ');

  const storageBlock = classifiable.match(/storage_block:[\w-]+/);
  if (storageBlock) return { kind: 'storage_quota', reason: storageBlock[0] };
  if (AUTH_ERROR_PATTERN.test(classifiable)) return { kind: 'auth', reason };
  if (NETWORK_ERROR_PATTERN.test(classifiable)) return { kind: 'network', reason };

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
    const deadline = Date.now() + UPLOAD_DEADLINE_MS;

    // The in-app proxy only covers the main process's undici dispatcher; the
    // CLI child needs it as env, plus env-proxy mode so its fetch honours it.
    // Env-proxy mode only reads HTTP(S)_PROXY, so a SOCKS5 proxy is exposed
    // to the child through a loopback HTTP CONNECT bridge.
    const proxyConfig = this.app.storeManager.get('networkProxy');
    const proxyEnv = buildProxyEnv(proxyConfig);
    let socksBridge: SocksHttpBridge | undefined;
    if (proxyEnv.ALL_PROXY && proxyConfig?.proxyType === 'socks5') {
      socksBridge = await startSocksHttpBridge(proxyConfig);
      delete proxyEnv.ALL_PROXY;
      proxyEnv.HTTP_PROXY = socksBridge.url;
      proxyEnv.HTTPS_PROXY = socksBridge.url;
    }

    const env = withProxyEnv(process.env, proxyEnv);
    env.ELECTRON_RUN_AS_NODE = '1';

    try {
      return await this.uploadWithEnv(filePath, env, deadline);
    } finally {
      await socksBridge?.close();
    }
  }

  private async uploadWithEnv(
    filePath: string,
    env: NodeJS.ProcessEnv,
    deadline: number,
  ): Promise<UploadedFileRecord | undefined> {
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

    const stdout = await this.runUploadWithRetry(filePath, env, deadline);

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
   * Every attempt — and the pause before it — comes out of one shared
   * {@link UPLOAD_DEADLINE_MS} budget.
   */
  private async runUploadWithRetry(
    filePath: string,
    env: NodeJS.ProcessEnv,
    deadline: number,
  ): Promise<string> {
    for (let attempt = 1; ; attempt++) {
      try {
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [resolveCliScript(), 'file', 'upload', filePath, '--json', 'id,url'],
          { env, timeout: Math.max(deadline - Date.now(), 1) },
        );
        return stdout;
      } catch (error) {
        const failure = describeUploadFailure(error);
        const retryDelay = UPLOAD_RETRY_BASE_DELAY_MS * attempt;
        if (
          failure.kind !== 'network' ||
          attempt >= UPLOAD_MAX_ATTEMPTS ||
          deadline - Date.now() - retryDelay < UPLOAD_MIN_ATTEMPT_MS
        ) {
          throw error;
        }

        logger.warn('Image upload failed, retrying:', {
          attempt,
          filePath,
          reason: failure.reason,
        });
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }
}
