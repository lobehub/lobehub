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
  webhookGate?: MessengerPlatformWebhookGate;
}
