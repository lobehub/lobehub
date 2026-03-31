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
 * Call Telegram setWebhook API. Idempotent — safe to call on every startup.
 */
export async function setTelegramWebhook(
  botToken: string,
  url: string,
  secretToken?: string,
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
    url,
  };
  if (secretToken) {
    params.secret_token = secretToken;
  }

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
