import type { WidgetRuntime } from '@lobechat/types';

/** Upper bound any provider accepts for one script execution. */
export const WIDGET_SANDBOX_MAX_TIMEOUT_MS = 120_000;
export const WIDGET_SANDBOX_DEFAULT_TIMEOUT_MS = 30_000;
/** Extra time a sandbox request may take beyond the script timeout (cold start, upload). */
export const WIDGET_SANDBOX_REQUEST_OVERHEAD_MS = 60_000;

/**
 * What the execution belongs to, for provider-side attribution, quotas and
 * log correlation. Never used for authorization — the caller already decided.
 */
export interface WidgetSandboxSubject {
  id: string;
  kind: 'widget';
}

export interface WidgetSandboxRunRequest {
  /** Variables exposed to this execution only; a provider must never persist them. */
  env: Record<string, string>;
  /** Hostnames the script may reach; an empty list means no network at all. */
  network: { allow: string[] };
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
 * Executes one widget script in isolation. Provider-agnostic on purpose: the
 * execution layer is moving to the lobehub-market service (a one-shot,
 * Cloudflare-backed run endpoint), so callers depend only on this contract
 * and the implementation is picked by `WIDGET_SANDBOX_PROVIDER`.
 *
 * A script that runs and exits non-zero, or times out, is a normal result —
 * judging it is the caller's job. Implementations throw `WidgetSandboxError`
 * only when the script could not be executed at all.
 */
export interface WidgetSandboxRunner {
  run: (request: WidgetSandboxRunRequest) => Promise<WidgetSandboxRunResult>;
}

export type WidgetSandboxErrorCode =
  'SANDBOX_BAD_REQUEST' | 'SANDBOX_ERROR' | 'SANDBOX_NOT_CONFIGURED' | 'SANDBOX_UNAUTHORIZED';

/** The sandbox could not execute the script at all (as opposed to the script failing). */
export class WidgetSandboxError extends Error {
  constructor(
    public readonly code: WidgetSandboxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WidgetSandboxError';
  }
}

export const clampSandboxTimeout = (timeoutMs?: number) => {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return WIDGET_SANDBOX_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.round(timeoutMs), WIDGET_SANDBOX_MAX_TIMEOUT_MS);
};
