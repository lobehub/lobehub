import { createHmac } from 'node:crypto';

import { getServerDBConfig } from '@/config/db';

import { TELEGRAM_API_BASE } from './api';

/**
 * Extract the bot user ID from a Telegram bot token.
 * Telegram bot tokens have the format: `<bot_id>:<secret>`.
 */
export function extractBotId(botToken: string): string {
  const colonIndex = botToken.indexOf(':');
  if (colonIndex === -1) return botToken;
  return botToken.slice(0, colonIndex);
}

/**
 * Salt used when no server-side key is configured. The derived secret is then
 * a pure function of the bot token — still unguessable to anyone who does not
 * already hold the token, which is the actual credential.
 */
const TELEGRAM_WEBHOOK_SECRET_FALLBACK_KEY = 'lobehub-telegram-webhook-secret';

/**
 * Derive a deterministic webhook secret for a bot from its token.
 *
 * Webhook verification is always on for Telegram bots on this platform
 * (`@chat-adapter/telegram` >= 4.39 refuses unverified webhooks by default,
 * and we do not want to opt out). Telegram does not hand out a secret — the
 * operator has to invent one — so when the channel owner leaves the field
 * blank we derive one instead of forcing them to paste a random string.
 *
 * Because the value is a pure function of `(serverKey, botToken)`, the two
 * independent call sites — `setWebhook` at start-up and the inbound adapter —
 * agree without persisting anything, and existing rows need no backfill.
 *
 * Output is base64url (43 chars, `A-Za-z0-9_-`), which is exactly the charset
 * and well within the 1–256 length Telegram accepts for `secret_token`.
 */
export function deriveTelegramWebhookSecret(botToken: string, serverKey?: string): string {
  return createHmac('sha256', serverKey || TELEGRAM_WEBHOOK_SECRET_FALLBACK_KEY)
    .update(botToken)
    .digest('base64url');
}

/**
 * The secret token to use for a bot: the operator-provided value wins, an
 * empty/blank field falls back to the derived secret. Never returns empty.
 */
export function resolveTelegramSecretToken(
  credentials: Record<string, string | undefined>,
): string {
  const explicit = credentials.secretToken?.trim();
  if (explicit) return explicit;
  return deriveTelegramWebhookSecret(
    credentials.botToken ?? '',
    getServerDBConfig().KEY_VAULTS_SECRET,
  );
}

/**
 * Call Telegram setWebhook API. Idempotent — safe to call on every startup.
 */
export async function setTelegramWebhook(
  botToken: string,
  url: string,
  secretToken: string,
): Promise<void> {
  const params: Record<string, unknown> = {
    // Explicitly request all update types we need, including group messages.
    // Without this, Telegram keeps whatever `allowed_updates` was set previously,
    // which may silently exclude group messages.
    allowed_updates: [
      'message',
      'edited_message',
      'channel_post',
      'edited_channel_post',
      'callback_query',
      'message_reaction',
    ],
    secret_token: secretToken,
    url,
  };

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/setWebhook`, {
    body: JSON.stringify(params),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to set Telegram webhook: ${response.status} ${text}`);
  }
}
