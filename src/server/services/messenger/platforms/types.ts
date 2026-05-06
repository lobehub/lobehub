import type { MessengerPlatform } from '@/config/messenger';

import type { InstallationCredentials } from '../installations/types';
import type { MessengerPlatformBinder } from '../types';

/** Cross-cutting services the router exposes to platform webhook gates. */
export interface MessengerWebhookContext {
  /**
   * Drop a cached Chat SDK bot for the given installationKey. Slack uses
   * this on `app_uninstalled` / `tokens_revoked` so a re-install picks up
   * the fresh token instead of reusing the dead one.
   */
  invalidateBot: (installationKey: string) => void;
}

/**
 * Platform-specific webhook preprocessing — signature verification, setup
 * challenges, lifecycle events. Implementations short-circuit by returning a
 * `Response`; returning `null` lets the router fall through to the shared
 * install-resolution + chat-sdk dispatch path.
 *
 * Telegram and Discord don't need any of this today (Telegram verifies via
 * webhook secret at the `chat-adapter-telegram` layer, Discord verifies via
 * Ed25519 inside `chat-adapter-discord`), so they don't expose a gate.
 */
export interface MessengerPlatformWebhookGate {
  preprocess: (
    req: Request,
    rawBody: string,
    ctx: MessengerWebhookContext,
  ) => Promise<Response | null>;
}

/**
 * Normalized result of an OAuth code exchange. Each platform's `exchangeCode`
 * flattens its native response shape into this so the dynamic route layer
 * can persist to `messenger_installations` without knowing about
 * `team`/`enterprise` (Slack), `guild` (Discord), etc.
 */
export interface NormalizedInstallation {
  /** Platform-side bot user id (Slack `bot_user_id`); null for platforms that don't expose one. */
  accountId: string | null;
  /** App-level identifier (Slack `app_id`, Discord application id). */
  applicationId: string;
  /** Plaintext credentials JSON — encrypted by `MessengerInstallationModel.upsert`. */
  credentials: Record<string, unknown>;
  /** Platform user id of whoever ran the install (Slack `authed_user.id`, Discord OAuth user). */
  installedByPlatformUserId: string | null;
  /** Free-form metadata persisted alongside the row (scope, tenant name, …). */
  metadata: Record<string, unknown>;
  /** Tenant identifier — Slack `team.id`/`enterprise.id`, Discord `guild.id`. */
  tenantId: string;
  /** Display label for the tenant — surfaced in error redirects (e.g. already_installed dialog). */
  tenantName?: string;
  /** Rotating-token expiry. `null` means the access token does not rotate. */
  tokenExpiresAt: Date | null;
}

export interface OAuthBuildAuthorizeUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
}

export interface OAuthExchangeCodeParams {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

/**
 * Per-platform OAuth install hooks consumed by the `[platform]/install` and
 * `[platform]/oauth/callback` dynamic routes. Slack today; Discord next.
 *
 * The route layer owns shared concerns (session, state, encryption, takeover
 * guard, persistence). Each adapter only owns the platform-specific shape:
 * authorize URL, token exchange + normalization, and (optionally) the success
 * redirect when the platform has a "open in app" deep link.
 */
export interface MessengerPlatformOAuthAdapter {
  /**
   * Build the platform's authorize URL. Caller has already validated config
   * and minted state — this is a pure URL builder.
   */
  buildAuthorizeUrl: (params: OAuthBuildAuthorizeUrlParams) => string;
  /**
   * Final redirect after a successful install. Returning `null` falls back to
   * the route's default `/settings/messenger?<platform>_installed=ok`.
   * Slack uses this to deep-link `slack.com/app/open?team=...&id=...`.
   */
  buildPostInstallRedirect?: (install: NormalizedInstallation, origin: string) => URL | null;
  /**
   * Exchange the OAuth `code` for credentials and normalize into our schema.
   * Throws on upstream / validation failure — the route maps that to
   * `?<platform>_error=exchange_failed`.
   */
  exchangeCode: (params: OAuthExchangeCodeParams) => Promise<NormalizedInstallation>;
  /**
   * Resolve the per-deployment App config (clientId / clientSecret). Returns
   * null when the platform isn't configured in dc-center, which the route
   * surfaces as a 503.
   */
  getAppConfig: () => Promise<{ clientId: string; clientSecret: string } | null>;
}

/**
 * Per-platform definition consumed by `MessengerRouter`. Mirrors the shape of
 * `bot/platforms/<name>/definition.ts` so adding a new messenger platform is
 * a one-file change rather than a router-wide refactor.
 */
export interface MessengerPlatformDefinition {
  /**
   * Build the per-platform binder used for outbound replies and link
   * notifications. Per-tenant platforms (Slack today) accept the resolved
   * credentials; global-bot platforms (Telegram, Discord) ignore them.
   */
  createBinder: (creds?: InstallationCredentials) => MessengerPlatformBinder;
  id: MessengerPlatform;
  /**
   * Brand-name label shown in UI. Hard-coded per platform — these are
   * trademarks, not user-facing copy, so they are NOT translated. Surfaced
   * to the client through the `availablePlatforms` TRPC return.
   */
  name: string;
  /**
   * Per-tenant OAuth install flow. Present on platforms whose bot token is
   * minted at install time (Slack workspace install, Discord guild install).
   * Absent for global-bot platforms (Telegram).
   */
  oauth?: MessengerPlatformOAuthAdapter;
  webhookGate?: MessengerPlatformWebhookGate;
}

/**
 * Serialized definition for client consumption — strips the runtime-only
 * `createBinder` factory and the webhook gate (which carries closures and
 * Node-only deps). Mirrors `bot/platforms` `SerializedPlatformDefinition`.
 */
export type SerializedMessengerPlatformDefinition = Omit<
  MessengerPlatformDefinition,
  'createBinder' | 'oauth' | 'webhookGate'
>;
