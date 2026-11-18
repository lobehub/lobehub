import { appEnv } from '@/envs/app';
import {
  BOT_RUNTIME_STATUSES,
  type BotRuntimeStatusSnapshot,
  updateBotRuntimeStatus,
} from '@/server/services/gateway/runtimeStatus';

import type { BotPlatformRedisClient } from './types';

/**
 * Runtime-status error code of a bot whose platform connection is up but whose inbound events
 * cannot be handed to this server. Sending still works — outbound calls go straight to the
 * platform API — so outbound paths must not treat this bot as unusable.
 */
export const INBOUND_FORWARD_FAILED_ERROR_CODE = 'inbound_forward_failed';

/** True when a runtime status rules a bot out for outbound sends. */
export const isBotUnusableForSending = (
  snapshot: Pick<BotRuntimeStatusSnapshot, 'errorCode' | 'status'>,
) =>
  snapshot.status === BOT_RUNTIME_STATUSES.failed &&
  snapshot.errorCode !== INBOUND_FORWARD_FAILED_ERROR_CODE;

/**
 * Base URL a persistent connection (WebSocket, Stream, long polling) forwards inbound events to —
 * this server itself. Server-to-server calls prefer `INTERNAL_APP_URL`: behind a reverse proxy or
 * tailnet, or inside a container, the public `APP_URL` often does not resolve or connect from the
 * server itself, and every inbound message would be dropped.
 *
 * Only for that loopback. A URL a platform calls (Telegram's registered webhook) or a person opens
 * keeps the public `APP_URL`.
 */
export const resolveSelfWebhookBase = (appUrl?: string): string =>
  (appEnv.INTERNAL_APP_URL || appUrl || appEnv.APP_URL || '').trim().replace(/\/+$/, '');

/** The platform webhook route on this server, as a persistent connection's forwarding target. */
export const buildSelfWebhookUrl = (
  platform: string,
  applicationId: string,
  appUrl?: string,
): string => `${resolveSelfWebhookBase(appUrl)}/api/agent/webhooks/${platform}/${applicationId}`;

/** Outcome of one forwarded event: the status the webhook route answered, or what `fetch` threw. */
export interface SelfWebhookForwardResult {
  /** Set when no answer came back (connection refused, DNS failure, timeout). */
  error?: unknown;
  ok: boolean;
  /** HTTP status of the answer, when there was one. */
  status?: number;
}

/**
 * After the first drop, further drops are logged at most this often (each line carries the running
 * count). Discord forwards every Gateway event, so a dead loopback would otherwise log a line for
 * each typing indicator.
 */
export const FORWARD_FAILURE_REPORT_INTERVAL_MS = 60_000;

export interface SelfWebhookForwardMonitorOptions {
  applicationId: string;
  now?: () => number;
  platform: string;
  redisClient?: BotPlatformRedisClient;
  /** Lifetime of the status snapshot; the client's `connected` write uses the same one. */
  ttlMs?: number;
  webhookUrl: string;
}

/** `ECONNREFUSED`, `ENOTFOUND`, `timed out`, `HTTP 502`… — short enough for a status line. */
const describeForwardFailure = (result: SelfWebhookForwardResult): string => {
  if (result.status !== undefined) return `HTTP ${result.status}`;

  const error = result.error as
    { cause?: { code?: unknown }; code?: unknown; message?: unknown; name?: unknown } | undefined;
  const code = error?.cause?.code ?? error?.code;
  if (typeof code === 'string' && code) return code;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timed out';
  if (typeof error?.message === 'string' && error.message) return error.message;

  return String(result.error ?? 'unknown error');
};

const INTERNAL_APP_URL_HINT =
  'If the server runs behind a reverse proxy or in a container, set INTERNAL_APP_URL to an address it can reach itself on, such as http://localhost:3210.';

/**
 * Status line for the channel settings page. The forwarding URL stays out of it — it can be an
 * internal address — and goes to the server log instead.
 */
const buildStatusMessage = (result: SelfWebhookForwardResult, reason: string): string =>
  result.status === undefined
    ? `Messages reach the bot, but it cannot pass them on to this server (${reason}), so they are dropped. ${INTERNAL_APP_URL_HINT}`
    : `Messages reach the bot, but this server rejected them when they were passed on (${reason}), so they are dropped. Check the bot credentials, and that INTERNAL_APP_URL / APP_URL point to this server.`;

/**
 * Watches the forwarding leg of a persistent bot connection: platform → this process → the
 * platform webhook route over HTTP. That leg failing drops every inbound message while the
 * platform connection itself stays healthy, so it is reported where people look:
 *
 * - a dropped event is an error-level log line with the target URL, the reason and how many were
 *   dropped in a row — the first one at once, later ones at most once per
 *   `FORWARD_FAILURE_REPORT_INTERVAL_MS`;
 * - the bot's runtime status turns `failed` with an explanation, re-written on every drop: an event
 *   can be forwarded before the client's own `connected` write lands, and that write must not hide
 *   the failure. The first event that gets through again returns it to `connected`.
 */
export class SelfWebhookForwardMonitor {
  private consecutive = 0;
  private disposed = false;
  private lastReportedAt = Number.NEGATIVE_INFINITY;
  private readonly options: SelfWebhookForwardMonitorOptions;
  /** Status writes go out in order, so a quick drop → recovery cannot land reversed. */
  private writes: Promise<void> = Promise.resolve();

  constructor(options: SelfWebhookForwardMonitorOptions) {
    this.options = options;
  }

  /** Inbound events dropped in a row; the next delivered one resets it. */
  get consecutiveFailures(): number {
    return this.consecutive;
  }

  /**
   * Stop reporting: the connection was stopped or replaced, and a late result must not overwrite
   * the status its successor or `stop()` wrote.
   */
  dispose(): void {
    this.disposed = true;
  }

  /** Record one forwarded event. Never throws; resolves once the status write settled. */
  record = (result: SelfWebhookForwardResult): Promise<void> => {
    if (this.disposed) return this.writes;

    const { applicationId, platform, webhookUrl } = this.options;

    if (result.ok) {
      if (this.consecutive === 0) return this.writes;

      console.info(
        `[bot-platform:${platform}] Inbound events for ${applicationId} reach ${webhookUrl} again after ${this.consecutive} dropped in a row.`,
      );
      this.consecutive = 0;
      this.lastReportedAt = Number.NEGATIVE_INFINITY;
      return this.writeStatus({ status: BOT_RUNTIME_STATUSES.connected });
    }

    this.consecutive += 1;
    const reason = describeForwardFailure(result);
    const now = (this.options.now ?? Date.now)();
    if (this.consecutive === 1 || now - this.lastReportedAt >= FORWARD_FAILURE_REPORT_INTERVAL_MS) {
      this.lastReportedAt = now;
      console.error(
        `[bot-platform:${platform}] Dropped an inbound event for ${applicationId}: forwarding it to ${webhookUrl} failed (${reason}); ${this.consecutive} dropped in a row.${
          result.status === undefined ? ` ${INTERNAL_APP_URL_HINT}` : ''
        }`,
      );
    }

    return this.writeStatus({
      errorCode: INBOUND_FORWARD_FAILED_ERROR_CODE,
      errorMessage: buildStatusMessage(result, reason),
      status: BOT_RUNTIME_STATUSES.failed,
    });
  };

  private writeStatus(
    params: Pick<BotRuntimeStatusSnapshot, 'errorCode' | 'errorMessage' | 'status'>,
  ): Promise<void> {
    const { applicationId, platform, redisClient, ttlMs } = this.options;

    this.writes = this.writes.then(async () => {
      // Disposed while queued: `stop()` or the next start owns the status now.
      if (this.disposed) return;
      try {
        await updateBotRuntimeStatus(
          { applicationId, platform, ...params },
          { redisClient: redisClient as any, ttlMs },
        );
      } catch (error) {
        console.error(
          `[bot-platform:${platform}] Could not record the inbound forwarding status for ${applicationId}:`,
          error,
        );
      }
    });

    return this.writes;
  }
}
