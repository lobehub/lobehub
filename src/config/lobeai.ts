import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

/**
 * LobeAI shared-bot configuration.
 *
 * Distinct from per-user `agent_bot_providers`: a single LobeHub-owned bot is
 * registered on each platform (Telegram, Slack), and users link their account
 * to it via the verify-im flow. Tokens live in env vars (server-only).
 */
export const getLobeAIConfig = () => {
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

export const lobeAIEnv = getLobeAIConfig();

export type LobeAIPlatform = 'telegram' | 'slack';

export interface LobeAITelegramConfig {
  botToken: string;
  botUsername?: string;
  webhookSecret?: string;
}

export interface LobeAISlackConfig {
  botToken: string;
  signingSecret?: string;
}

export const getLobeAITelegramConfig = (): LobeAITelegramConfig | null => {
  const token = lobeAIEnv.LOBE_TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  return {
    botToken: token,
    botUsername: lobeAIEnv.LOBE_TELEGRAM_BOT_USERNAME,
    webhookSecret: lobeAIEnv.LOBE_TELEGRAM_WEBHOOK_SECRET,
  };
};

export const getLobeAISlackConfig = (): LobeAISlackConfig | null => {
  const token = lobeAIEnv.LOBE_SLACK_BOT_TOKEN;
  if (!token) return null;
  return {
    botToken: token,
    signingSecret: lobeAIEnv.LOBE_SLACK_SIGNING_SECRET,
  };
};

export const isLobeAIPlatformEnabled = (platform: LobeAIPlatform): boolean => {
  switch (platform) {
    case 'telegram': {
      return !!lobeAIEnv.LOBE_TELEGRAM_BOT_TOKEN;
    }
    case 'slack': {
      return !!lobeAIEnv.LOBE_SLACK_BOT_TOKEN;
    }
    default: {
      return false;
    }
  }
};

export const getEnabledLobeAIPlatforms = (): LobeAIPlatform[] => {
  return (['telegram', 'slack'] as const).filter((p) => isLobeAIPlatformEnabled(p));
};

export const getLobeAILinkTokenTtl = (): number => lobeAIEnv.LOBE_LINK_TOKEN_TTL_SECONDS;
