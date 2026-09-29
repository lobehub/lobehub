import type { DashboardWidgetRuntime } from '@lobechat/types';
import debug from 'debug';

import { sandboxEnv } from '@/envs/sandbox';

const log = debug('lobe-server:dashboard:sandbox-runner');

/** The Worker caps `timeoutMs` at this value; larger requests are rejected with 400. */
export const DASHBOARD_SANDBOX_MAX_TIMEOUT_MS = 120_000;
export const DASHBOARD_SANDBOX_DEFAULT_TIMEOUT_MS = 30_000;
/** Extra time the HTTP call waits beyond the script timeout (cold start, upload). */
const REQUEST_OVERHEAD_MS = 60_000;

export type DashboardSandboxErrorCode =
  'SANDBOX_NOT_CONFIGURED' | 'SANDBOX_UNAUTHORIZED' | 'SANDBOX_BAD_REQUEST' | 'SANDBOX_ERROR';

/** The sandbox could not execute the script at all (as opposed to the script failing). */
export class DashboardSandboxError extends Error {
  constructor(
    public readonly code: DashboardSandboxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DashboardSandboxError';
  }
}

export interface DashboardSandboxRunRequest {
  /** Variables exposed to this execution only; never persisted by the Worker. */
  env?: Record<string, string>;
  /** Whether the script may reach the network. */
  network?: boolean;
  runtime: DashboardWidgetRuntime;
  script: string;
  timeoutMs?: number;
}

export interface DashboardSandboxRunResult {
  durationMs: number;
  exitCode: number;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

export interface DashboardSandboxRunnerOptions {
  fetch?: typeof fetch;
  token?: string;
  url?: string;
}

/**
 * Executes widget scripts on the dashboard sandbox Worker
 * (`POST {DASHBOARD_SANDBOX_URL}/run`, Bearer `DASHBOARD_SANDBOX_TOKEN`).
 *
 * The Worker contract: request `{ script, runtime, env, network, timeoutMs }`,
 * response `{ stdout, stderr, exitCode, durationMs }`; a script that exceeds
 * its timeout answers 200 with `error: 'timeout'` and exit code 124, an
 * execution failure answers 500 with `error: 'execution_failed'`.
 *
 * A non-zero exit is a normal result here — judging it is the caller's job.
 * Only failures to execute at all throw `DashboardSandboxError`.
 */
export class DashboardSandboxRunner {
  private readonly fetchImpl: typeof fetch;
  private readonly token?: string;
  private readonly url?: string;

  constructor(options: DashboardSandboxRunnerOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.token = options.token;
    this.url = options.url?.replace(/\/+$/, '');
  }

  static fromEnv(options: Pick<DashboardSandboxRunnerOptions, 'fetch'> = {}) {
    return new DashboardSandboxRunner({
      ...options,
      token: sandboxEnv.DASHBOARD_SANDBOX_TOKEN,
      url: sandboxEnv.DASHBOARD_SANDBOX_URL,
    });
  }

  get isConfigured() {
    return !!this.url && !!this.token;
  }

  async run(request: DashboardSandboxRunRequest): Promise<DashboardSandboxRunResult> {
    if (!this.url || !this.token) {
      throw new DashboardSandboxError(
        'SANDBOX_NOT_CONFIGURED',
        'Dashboard sandbox is not configured: set DASHBOARD_SANDBOX_URL and DASHBOARD_SANDBOX_TOKEN',
      );
    }

    const timeoutMs = clampTimeout(request.timeoutMs);
    const body = {
      env: request.env ?? {},
      network: request.network ?? false,
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
      throw new DashboardSandboxError('SANDBOX_ERROR', `Sandbox request failed: ${message}`);
    }

    const payload = (await response.json().catch(() => null)) as WorkerRunResponse | null;

    if (response.status === 401) {
      throw new DashboardSandboxError('SANDBOX_UNAUTHORIZED', 'Sandbox rejected the credentials');
    }
    if (response.status === 400) {
      throw new DashboardSandboxError(
        'SANDBOX_BAD_REQUEST',
        `Sandbox rejected the request: ${payload?.error ?? 'bad request'}`,
      );
    }
    if (!payload || typeof payload !== 'object') {
      throw new DashboardSandboxError(
        'SANDBOX_ERROR',
        `Sandbox returned an unreadable response (HTTP ${response.status})`,
      );
    }

    const timedOut = payload.error === 'timeout';
    if (!response.ok && !timedOut) {
      throw new DashboardSandboxError(
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

interface WorkerRunResponse {
  durationMs?: number;
  error?: string;
  exitCode?: number;
  message?: string;
  stderr?: string;
  stdout?: string;
}

const clampTimeout = (timeoutMs?: number) => {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DASHBOARD_SANDBOX_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.round(timeoutMs), DASHBOARD_SANDBOX_MAX_TIMEOUT_MS);
};
