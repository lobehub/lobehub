import type { MessengerPlatform } from '@/config/messenger';

/**
 * Resolved per-tenant credentials handed to the binder + Chat SDK adapter.
 *
 * `installationKey` is the cache key used by `MessengerRouter` to keep one
 * Chat SDK instance per install (so a Slack workspace install A and B each
 * get their own bot loop, message queue, etc.).
 *
 * `tenantId` is opaque per platform — Slack `team_id` (or `enterprise_id`
 * for Grid org installs), Discord `guild_id`, Feishu `tenant_key`, MS Teams
 * tenantId. Global-bot platforms (Telegram today) use the empty string.
 */
export interface InstallationCredentials {
  /** Bot user id within the tenant — Slack `bot_user_id`, etc. */
  accountId?: string;
  /** Platform-side application/bot id (Slack `app_id`, …). */
  applicationId: string;
  /** The actual bot token used for outbound API calls. */
  botToken: string;
  /** Stable cache key, e.g. `'slack:T0123ABC'` or `'telegram:singleton'`. */
  installationKey: string;
  /** Platform-opaque metadata (tenantName, scope, enterpriseId, …). */
  metadata: Record<string, unknown>;
  platform: MessengerPlatform;
  /** Slack uses this for inbound signature verification. */
  signingSecret?: string;
  /** Empty string for global-bot platforms. */
  tenantId: string;
}

/**
 * Per-platform credential resolver. Implementations encapsulate where the
 * credentials live (env vs DB), how to decrypt them, and how to refresh
 * rotating tokens — the router treats them all the same.
 *
 * The router calls `resolveByPayload` on every inbound webhook (it has the
 * raw bytes from Slack / Telegram). Bot lifecycle helpers that already know
 * the install (e.g. `MessengerRouter.getOrCreateBot('slack:T0123')`) call
 * `resolveByKey` directly.
 */
export interface MessengerInstallationStore {
  /**
   * Mark an install as revoked. Called by the router when Slack delivers
   * `app_uninstalled` / `tokens_revoked`. No-op for global-bot platforms.
   */
  markRevoked?: (installationKey: string) => Promise<void>;

  /**
   * Resolve from a previously-cached `installationKey`. Used by router
   * cache-miss paths and by background jobs (e.g. token rotation cron).
   */
  resolveByKey: (installationKey: string) => Promise<InstallationCredentials | null>;

  /** Resolve from a raw inbound webhook (Events API / interactivity / slash). */
  resolveByPayload: (req: Request, rawBody: string) => Promise<InstallationCredentials | null>;
}
