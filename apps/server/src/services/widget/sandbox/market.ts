import { MarketAPIError, type MarketSDK } from '@lobehub/market-sdk';
import debug from 'debug';

import { resolveSandboxRunLimits, type SandboxRunLimits } from '@/business/server/sandboxRun';
import { isTrustedClientEnabled } from '@/libs/trusted-client';
import { MarketService } from '@/server/services/market';

import {
  clampSandboxTimeout,
  WIDGET_SANDBOX_REQUEST_OVERHEAD_MS,
  type WidgetSandboxActor,
  WidgetSandboxError,
  type WidgetSandboxRunner,
  type WidgetSandboxRunRequest,
  type WidgetSandboxRunResult,
} from './types';

const log = debug('lobe-server:widget:sandbox');

type SandboxClient = Pick<MarketSDK['sandbox'], 'run'>;

export interface MarketWidgetSandboxRunnerOptions {
  /** Defaults to `isTrustedClientEnabled`: Market only accepts trusted clients here. */
  isEnabled?: () => boolean;
  /** Defaults to the `sandboxRun` business hook (the actor's plan). */
  resolveLimits?: (actor: WidgetSandboxActor) => Promise<SandboxRunLimits | null>;
  /**
   * Defaults to the Market SDK acting as the run's actor, with the resolved
   * limits signed onto its trusted-client token as the `sandboxRun` claim.
   */
  sandboxFor?: (actor: WidgetSandboxActor, limits: SandboxRunLimits | null) => SandboxClient;
}

const defaultSandboxFor = (
  actor: WidgetSandboxActor,
  limits: SandboxRunLimits | null,
): SandboxClient =>
  new MarketService({
    userInfo: {
      sandboxRun: limits,
      userId: actor.userId,
      workspaceId: actor.workspaceId ?? undefined,
    },
  }).market.sandbox;

const defaultResolveLimits = (actor: WidgetSandboxActor) =>
  resolveSandboxRunLimits({ userId: actor.userId, workspaceId: actor.workspaceId ?? null });

/** Market's fixed backoff for `concurrency_limited`, used when it sends no hint we can read. */
const CONCURRENCY_RETRY_AFTER_MS = 5000;
/** Market's rate window: fixed, epoch-aligned minutes. */
const RATE_WINDOW_MS = 60_000;

/**
 * When Market expects the account to have room again. Market sends the hint as
 * a `Retry-After` header, which the SDK error does not carry, so a body field
 * (`retry_after`, seconds) is read when present and otherwise Market's own
 * rules are mirrored: a fixed 5 s for concurrency, the rest of the current
 * epoch-aligned minute for rate.
 */
export const marketRetryAfterMs = (
  error: MarketAPIError,
  code: string,
  now: number = Date.now(),
): number => {
  const hinted = (error.errorBody as { retry_after?: unknown } | undefined)?.retry_after;
  const seconds = typeof hinted === 'string' ? Number(hinted) : hinted;
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    return Math.min(Math.ceil(seconds * 1000), RATE_WINDOW_MS);
  }
  if (code === 'rate_limited') return Math.max(1000, RATE_WINDOW_MS - (now % RATE_WINDOW_MS));
  return CONCURRENCY_RETRY_AFTER_MS;
};

/**
 * Only a positive integer is a claim Market accepts — anything else makes it
 * reject the whole token — so a malformed answer degrades to no claim.
 */
const sanitizeLimits = (limits: SandboxRunLimits | null | undefined): SandboxRunLimits | null => {
  const max = limits?.maxConcurrency;
  return typeof max === 'number' && Number.isSafeInteger(max) && max > 0
    ? { maxConcurrency: max }
    : null;
};

/** Market's error body: `{ error: '<code>', error_description?: '…' }`. */
const describeMarketError = (error: MarketAPIError) => {
  const body = error.errorBody as { error?: unknown; error_description?: unknown } | undefined;
  const code = typeof body?.error === 'string' ? body.error : (error.code ?? 'unknown_error');
  const detail = typeof body?.error_description === 'string' ? body.error_description : undefined;
  return { code, message: detail ? `${code}: ${detail}` : code };
};

/**
 * Widget sandbox behind Market's one-shot run endpoint (`sdk.sandbox.run`).
 * Market authenticates the trusted-client token for the run's actor, rate
 * limits that account, resolves `egress.inject` secret references against that
 * account's credentials, and signs the request to the widget sandbox Worker,
 * which enforces the egress allowlist and sets the injected headers per run.
 *
 * Market answers 200 for every script that ran — including non-zero exits and
 * timeouts; the SDK throws `MarketAPIError` when the script did not run.
 */
export class MarketWidgetSandboxRunner implements WidgetSandboxRunner {
  private readonly isEnabled: () => boolean;
  private readonly resolveLimits: NonNullable<MarketWidgetSandboxRunnerOptions['resolveLimits']>;
  private readonly sandboxFor: NonNullable<MarketWidgetSandboxRunnerOptions['sandboxFor']>;

  constructor(options: MarketWidgetSandboxRunnerOptions = {}) {
    this.isEnabled = options.isEnabled ?? isTrustedClientEnabled;
    this.resolveLimits = options.resolveLimits ?? defaultResolveLimits;
    this.sandboxFor = options.sandboxFor ?? defaultSandboxFor;
  }

  /** Never throws: a failed plan lookup runs at Market's default concurrency instead. */
  private async limitsFor(actor: WidgetSandboxActor): Promise<SandboxRunLimits | null> {
    try {
      return sanitizeLimits(await this.resolveLimits(actor));
    } catch (error) {
      log('sandbox run limits lookup failed for %s: %O', actor.userId, error);
      return null;
    }
  }

  async run(request: WidgetSandboxRunRequest): Promise<WidgetSandboxRunResult> {
    if (!this.isEnabled()) {
      throw new WidgetSandboxError(
        'SANDBOX_NOT_CONFIGURED',
        'Widget sandbox is not configured: Market trusted-client credentials are missing',
      );
    }

    const timeoutMs = clampSandboxTimeout(request.timeoutMs);
    const limits = await this.limitsFor(request.actor);
    try {
      const result = await this.sandboxFor(request.actor, limits).run(
        {
          egress: {
            allow: request.network.allow,
            ...(request.network.inject?.length ? { inject: request.network.inject } : {}),
          },
          env: request.env,
          runtime: request.runtime,
          script: request.script,
          subject: request.subject,
          timeoutMs,
        },
        { signal: AbortSignal.timeout(timeoutMs + WIDGET_SANDBOX_REQUEST_OVERHEAD_MS) },
      );

      return {
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
        timedOut: result.timedOut,
      };
    } catch (error) {
      if (!(error instanceof MarketAPIError)) {
        const message = error instanceof Error ? error.message : String(error);
        log('request failed: %s', message);
        throw new WidgetSandboxError('SANDBOX_ERROR', `Sandbox request failed: ${message}`);
      }

      const { code, message } = describeMarketError(error);
      log('market responded status=%d error=%s', error.status, code);

      if (code === 'sandbox_not_configured') {
        throw new WidgetSandboxError(
          'SANDBOX_NOT_CONFIGURED',
          'Widget sandbox is not configured on Market',
        );
      }
      if (error.status === 401 || error.status === 403) {
        throw new WidgetSandboxError(
          'SANDBOX_UNAUTHORIZED',
          `Sandbox rejected the credentials (${message})`,
        );
      }
      // The account is at its concurrency or rate limit: the run is fine, it
      // just has to wait for a slot. Callers queue or retry it.
      if (error.status === 429 || code === 'concurrency_limited' || code === 'rate_limited') {
        throw new WidgetSandboxError(
          'SANDBOX_BUSY',
          `Sandbox is busy for this account: ${message}`,
          {
            retryAfterMs: marketRetryAfterMs(error, code),
          },
        );
      }
      if (error.status === 400 || error.status === 422) {
        throw new WidgetSandboxError(
          'SANDBOX_BAD_REQUEST',
          `Sandbox rejected the request: ${message}`,
        );
      }
      throw new WidgetSandboxError(
        'SANDBOX_ERROR',
        `Sandbox could not run the script (HTTP ${error.status}): ${message}`,
      );
    }
  }
}
