import type { WidgetRuntime } from '@lobechat/types';

/** Upper bound any provider accepts for one script execution. */
export const WIDGET_SANDBOX_MAX_TIMEOUT_MS = 120_000;
export const WIDGET_SANDBOX_DEFAULT_TIMEOUT_MS = 30_000;
/** Extra time a sandbox request may take beyond the script timeout (cold start, upload). */
export const WIDGET_SANDBOX_REQUEST_OVERHEAD_MS = 60_000;

/**
 * Whose account the execution runs on: Market authenticates, rate limits and
 * bills it as this user (or as the workspace's organization). The caller has
 * already decided the run is allowed.
 */
export interface WidgetSandboxActor {
  userId: string;
  workspaceId?: string | null;
}

/**
 * What the execution belongs to, for provider-side attribution and log
 * correlation. Never used for authorization — the caller already decided.
 */
export interface WidgetSandboxSubject {
  id: string;
  kind: 'widget';
}

/**
 * A credential header the provider's egress proxy sets on requests to `host`
 * (overwriting whatever the script sent). The secret is referenced, never
 * carried: the provider resolves `secretRef` against the actor's credentials,
 * so it never enters the sandbox nor passes through this server.
 */
export interface WidgetSandboxEgressInject {
  header: string;
  /** Exact hostname or `*.domain`; must be covered by `network.allow`. */
  host: string;
  /** Literal prepended to the secret, e.g. `Bearer `. */
  prefix?: string;
  secretRef: { field?: string; key: string };
}

export interface WidgetSandboxRunRequest {
  actor: WidgetSandboxActor;
  /** Variables exposed to this execution only; a provider must never persist them. */
  env: Record<string, string>;
  /**
   * Hostnames the script may reach (an empty list means no network at all),
   * plus the credential headers added on the way out.
   */
  network: { allow: string[]; inject?: WidgetSandboxEgressInject[] };
  runtime: WidgetRuntime;
  script: string;
  subject: WidgetSandboxSubject;
  /** Clamped by the provider to `WIDGET_SANDBOX_MAX_TIMEOUT_MS`. */
  timeoutMs?: number;
}

export interface WidgetSandboxRunResult {
  durationMs: number;
  exitCode: number;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

/**
 * Executes one widget script in isolation. The only implementation forwards to
 * Market's one-shot run endpoint, which runs it on the widget sandbox Worker
 * (lobehub-biz/widget-sandbox); callers depend only on this contract.
 *
 * A script that runs and exits non-zero, or times out, is a normal result —
 * judging it is the caller's job. Implementations throw `WidgetSandboxError`
 * only when the script could not be executed at all.
 */
export interface WidgetSandboxRunner {
  run: (request: WidgetSandboxRunRequest) => Promise<WidgetSandboxRunResult>;
}

export type WidgetSandboxErrorCode =
  | 'SANDBOX_BAD_REQUEST'
  | 'SANDBOX_BUSY'
  | 'SANDBOX_ERROR'
  | 'SANDBOX_NOT_CONFIGURED'
  | 'SANDBOX_UNAUTHORIZED';

/**
 * The sandbox could not execute the script at all (as opposed to the script failing).
 *
 * `SANDBOX_BUSY` is the one transient code: the actor's account is at its
 * concurrency or rate limit and the same request will run once a slot frees
 * up. `retryAfterMs` says when that is expected.
 */
export class WidgetSandboxError extends Error {
  public readonly retryAfterMs?: number;

  constructor(
    public readonly code: WidgetSandboxErrorCode,
    message: string,
    options: { retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'WidgetSandboxError';
    this.retryAfterMs = options.retryAfterMs;
  }
}

export const isWidgetSandboxBusy = (
  error: unknown,
): error is WidgetSandboxError & { code: 'SANDBOX_BUSY' } =>
  error instanceof WidgetSandboxError && error.code === 'SANDBOX_BUSY';

export const clampSandboxTimeout = (timeoutMs?: number) => {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return WIDGET_SANDBOX_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.round(timeoutMs), WIDGET_SANDBOX_MAX_TIMEOUT_MS);
};
