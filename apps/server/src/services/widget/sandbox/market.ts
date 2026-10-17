import { MarketAPIError, type MarketSDK } from '@lobehub/market-sdk';
import debug from 'debug';

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
  /** Defaults to the Market SDK acting as the run's actor. */
  sandboxFor?: (actor: WidgetSandboxActor) => SandboxClient;
}

const defaultSandboxFor = (actor: WidgetSandboxActor): SandboxClient =>
  new MarketService({
    userInfo: { userId: actor.userId, workspaceId: actor.workspaceId ?? undefined },
  }).market.sandbox;

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
 * limits that account, and signs the request to the widget sandbox Worker,
 * which enforces the egress allowlist per run.
 *
 * Market answers 200 for every script that ran — including non-zero exits and
 * timeouts; the SDK throws `MarketAPIError` when the script did not run.
 */
export class MarketWidgetSandboxRunner implements WidgetSandboxRunner {
  private readonly isEnabled: () => boolean;
  private readonly sandboxFor: (actor: WidgetSandboxActor) => SandboxClient;

  constructor(options: MarketWidgetSandboxRunnerOptions = {}) {
    this.isEnabled = options.isEnabled ?? isTrustedClientEnabled;
    this.sandboxFor = options.sandboxFor ?? defaultSandboxFor;
  }

  async run(request: WidgetSandboxRunRequest): Promise<WidgetSandboxRunResult> {
    if (!this.isEnabled()) {
      throw new WidgetSandboxError(
        'SANDBOX_NOT_CONFIGURED',
        'Widget sandbox is not configured: Market trusted-client credentials are missing',
      );
    }

    const timeoutMs = clampSandboxTimeout(request.timeoutMs);
    try {
      const result = await this.sandboxFor(request.actor).run(
        {
          egress: { allow: request.network.allow },
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
