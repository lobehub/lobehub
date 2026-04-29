import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

/**
 * Shared Messenger bot configuration.
 *
 * Distinct from per-user `agent_bot_providers`: a single LobeHub-owned bot is
 * registered on each platform (Telegram, Slack), and users link their account
 * to it via the verify-im flow. Tokens live in env vars (server-only).
 */
export const getMessengerConfig = () => {
  return createEnv({
    client: {},
    runtimeEnv: {
      LOBE_LINK_TOKEN_TTL_SECONDS: process.env.LOBE_LINK_TOKEN_TTL_SECONDS,
      LOBE_SLACK_BOT_TOKEN: process.env.LOBE_SLACK_BOT_TOKEN,
      LOBE_SLACK_SIGNING_SECRET: process.env.LOBE_SLACK_SIGNING_SECRET,
      LOBE_TELEGRAM_BOT_TOKEN: process.env.LOBE_TELEGRAM_BOT_TOKEN,
      LOBE_TELEGRAM_BOT_USERNAME: process.env.LOBE_TELEGRAM_BOT_USERNAME,
      LOBE_TELEGRAM_WEBHOOK_SECRET: process.env.LOBE_TELEGRAM_WEBHOOK_SECRET,
    },
    server: {
      LOBE_LINK_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
      LOBE_SLACK_BOT_TOKEN: z.string().optional(),
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
  botToken: string;
  signingSecret?: string;
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

export const getMessengerSlackConfig = (): MessengerSlackConfig | null => {
  const token = messengerEnv.LOBE_SLACK_BOT_TOKEN;
  if (!token) return null;
  return {
    botToken: token,
    signingSecret: messengerEnv.LOBE_SLACK_SIGNING_SECRET,
  };
};

export const isMessengerPlatformEnabled = (platform: MessengerPlatform): boolean => {
  switch (platform) {
    case 'telegram': {
      return !!messengerEnv.LOBE_TELEGRAM_BOT_TOKEN;
    }
    case 'slack': {
      return !!messengerEnv.LOBE_SLACK_BOT_TOKEN;
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
