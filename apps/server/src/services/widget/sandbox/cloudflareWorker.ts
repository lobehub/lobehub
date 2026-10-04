import debug from 'debug';

import {
  clampSandboxTimeout,
  WidgetSandboxError,
  type WidgetSandboxRunner,
  type WidgetSandboxRunRequest,
  type WidgetSandboxRunResult,
} from './types';

const log = debug('lobe-server:widget:sandbox');

/** Extra time the HTTP call waits beyond the script timeout (cold start, upload). */
const REQUEST_OVERHEAD_MS = 60_000;

/**
 * How the request encodes the network allowlist:
 *
 * - `allowlist` — `network: { allow: ['api.github.com', …] }`, so the Worker
 *   can restrict egress to the declared hosts;
 * - `boolean` — `network: allow.length > 0`, for a Worker that only
 *   understands an on/off switch (the original contract). Hosts are then not
 *   enforced by the sandbox.
 */
export type CloudflareWorkerNetworkFormat = 'allowlist' | 'boolean';

export interface CloudflareWorkerSandboxRunnerOptions {
  fetch?: typeof fetch;
  networkFormat?: CloudflareWorkerNetworkFormat;
  token?: string;
  url?: string;
}

interface WorkerRunResponse {
  durationMs?: number;
  error?: string;
  exitCode?: number;
  message?: string;
  stderr?: string;
  stdout?: string;
}

/**
 * Widget sandbox backed by a Cloudflare Worker
 * (`POST {WIDGET_SANDBOX_URL}/run`, Bearer `WIDGET_SANDBOX_TOKEN`).
 *
 * Worker contract: request `{ script, runtime, env, network, timeoutMs }`,
 * response `{ stdout, stderr, exitCode, durationMs }`; a script exceeding its
 * timeout answers 200 with `error: 'timeout'` (exit code 124), an execution
 * failure answers 500 with `error: 'execution_failed'`.
 *
 * `subject` is not sent: the Worker has no use for it and rejects nothing
 * based on it.
 */
export class CloudflareWorkerSandboxRunner implements WidgetSandboxRunner {
  private readonly fetchImpl: typeof fetch;
  private readonly networkFormat: CloudflareWorkerNetworkFormat;
  private readonly token?: string;
  private readonly url?: string;

  constructor(options: CloudflareWorkerSandboxRunnerOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.networkFormat = options.networkFormat ?? 'boolean';
    this.token = options.token;
    this.url = options.url?.replace(/\/+$/, '');
  }

  get isConfigured() {
    return !!this.url && !!this.token;
  }

  async run(request: WidgetSandboxRunRequest): Promise<WidgetSandboxRunResult> {
    if (!this.url || !this.token) {
      throw new WidgetSandboxError(
        'SANDBOX_NOT_CONFIGURED',
        'Widget sandbox is not configured: set WIDGET_SANDBOX_URL and WIDGET_SANDBOX_TOKEN',
      );
    }

    const timeoutMs = clampSandboxTimeout(request.timeoutMs);
    const allow = request.network.allow;
    const body = {
      env: request.env,
      network: this.networkFormat === 'boolean' ? allow.length > 0 : { allow },
      runtime: request.runtime,
      script: request.script,
      timeoutMs,
    };

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}/run`, {
        body: JSON.stringify(body),
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs + REQUEST_OVERHEAD_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('request failed: %s', message);
      throw new WidgetSandboxError('SANDBOX_ERROR', `Sandbox request failed: ${message}`);
    }

    const payload = (await response.json().catch(() => null)) as WorkerRunResponse | null;

    if (response.status === 401) {
      throw new WidgetSandboxError('SANDBOX_UNAUTHORIZED', 'Sandbox rejected the credentials');
    }
    if (response.status === 400) {
      throw new WidgetSandboxError(
        'SANDBOX_BAD_REQUEST',
        `Sandbox rejected the request: ${payload?.error ?? 'bad request'}`,
      );
    }
    if (!payload || typeof payload !== 'object') {
      throw new WidgetSandboxError(
        'SANDBOX_ERROR',
        `Sandbox returned an unreadable response (HTTP ${response.status})`,
      );
    }

    const timedOut = payload.error === 'timeout';
    if (!response.ok && !timedOut) {
      throw new WidgetSandboxError(
        'SANDBOX_ERROR',
        `Sandbox execution failed (HTTP ${response.status}): ${payload.message ?? payload.error ?? 'unknown error'}`,
      );
    }

    return {
      durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : 0,
      exitCode: typeof payload.exitCode === 'number' ? payload.exitCode : timedOut ? 124 : -1,
      stderr: typeof payload.stderr === 'string' ? payload.stderr : '',
      stdout: typeof payload.stdout === 'string' ? payload.stdout : '',
      timedOut,
    };
  }
}
