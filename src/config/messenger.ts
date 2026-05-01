import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

/**
 * Shared Messenger bot configuration.
 *
 * Two distribution models live in this file:
 *
 * - **Global-token platforms (Telegram)**: a single LobeHub-owned bot token
 *   in env serves every user. The bot is registered once via `setWebhook`.
 *
 * - **Per-tenant OAuth platforms (Slack)**: env holds App-level credentials
 *   only (`CLIENT_ID` / `CLIENT_SECRET` / `SIGNING_SECRET` / `APP_ID`); each
 *   workspace bot token is acquired via OAuth on install and stored in
 *   `messenger_installations`. Self-hosters register their own Slack App;
 *   Cloud uses the LobeHub-published one.
 */
export const getMessengerConfig = () => {
  return createEnv({
    client: {},
    runtimeEnv: {
      LOBE_LINK_TOKEN_TTL_SECONDS: process.env.LOBE_LINK_TOKEN_TTL_SECONDS,
      LOBE_SLACK_APP_ID: process.env.LOBE_SLACK_APP_ID,
      LOBE_SLACK_CLIENT_ID: process.env.LOBE_SLACK_CLIENT_ID,
      LOBE_SLACK_CLIENT_SECRET: process.env.LOBE_SLACK_CLIENT_SECRET,
      LOBE_SLACK_SIGNING_SECRET: process.env.LOBE_SLACK_SIGNING_SECRET,
      LOBE_TELEGRAM_BOT_TOKEN: process.env.LOBE_TELEGRAM_BOT_TOKEN,
      LOBE_TELEGRAM_BOT_USERNAME: process.env.LOBE_TELEGRAM_BOT_USERNAME,
      LOBE_TELEGRAM_WEBHOOK_SECRET: process.env.LOBE_TELEGRAM_WEBHOOK_SECRET,
    },
    server: {
      LOBE_LINK_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
      LOBE_SLACK_APP_ID: z.string().optional(),
      LOBE_SLACK_CLIENT_ID: z.string().optional(),
      LOBE_SLACK_CLIENT_SECRET: z.string().optional(),
      LOBE_SLACK_SIGNING_SECRET: z.string().optional(),
      LOBE_TELEGRAM_BOT_TOKEN: z.string().optional(),
      LOBE_TELEGRAM_BOT_USERNAME: z.string().optional(),
      LOBE_TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    },
  });
};

export const messengerEnv = getMessengerConfig();

export type MessengerPlatform = 'telegram' | 'slack';

export interface MessengerTelegramConfig {
  botToken: string;
  botUsername?: string;
  webhookSecret?: string;
}

export interface MessengerSlackConfig {
  appId: string;
  clientId: string;
  clientSecret: string;
  signingSecret: string;
}

export const getMessengerTelegramConfig = (): MessengerTelegramConfig | null => {
  const token = messengerEnv.LOBE_TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  return {
    botToken: token,
    botUsername: messengerEnv.LOBE_TELEGRAM_BOT_USERNAME,
    webhookSecret: messengerEnv.LOBE_TELEGRAM_WEBHOOK_SECRET,
  };
};

/**
 * App-level OAuth credentials for the Slack messenger. Per-workspace bot
 * tokens are NOT here — they live in `messenger_installations` after OAuth.
 *
 * Returns null when any of the four required vars is missing — the install /
 * webhook routes will then report 503/404 instead of letting the OAuth dance
 * fail mid-flow.
 */
export const getMessengerSlackConfig = (): MessengerSlackConfig | null => {
  const clientId = messengerEnv.LOBE_SLACK_CLIENT_ID;
  const clientSecret = messengerEnv.LOBE_SLACK_CLIENT_SECRET;
  const signingSecret = messengerEnv.LOBE_SLACK_SIGNING_SECRET;
  const appId = messengerEnv.LOBE_SLACK_APP_ID;
  if (!clientId || !clientSecret || !signingSecret || !appId) return null;
  return { appId, clientId, clientSecret, signingSecret };
};

export const isMessengerPlatformEnabled = (platform: MessengerPlatform): boolean => {
  switch (platform) {
    case 'telegram': {
      return !!messengerEnv.LOBE_TELEGRAM_BOT_TOKEN;
    }
    case 'slack': {
      return !!getMessengerSlackConfig();
    }
    default: {
      return false;
    }
  }
};

export const getEnabledMessengerPlatforms = (): MessengerPlatform[] => {
  return (['telegram', 'slack'] as const).filter((p) => isMessengerPlatformEnabled(p));
};

export const getMessengerLinkTokenTtl = (): number => messengerEnv.LOBE_LINK_TOKEN_TTL_SECONDS;
