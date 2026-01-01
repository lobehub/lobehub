/* eslint-disable sort-keys-fix/sort-keys-fix */
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

import type { RedisConfig } from '@/libs/redis';

type UpstashRedisConfig = { token: string; url: string };

const parseNumber = (value?: string) => {
  const parsed = Number.parseInt(value ?? '', 10);

  return Number.isInteger(parsed) ? parsed : undefined;
};

const parseRedisTls = (value?: string) => {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
};

export const getRedisEnv = () => {
  return createEnv({
    runtimeEnv: {
      REDIS_DATABASE: parseNumber(process.env.REDIS_DATABASE),
      REDIS_PASSWORD: process.env.REDIS_PASSWORD,
      REDIS_PREFIX: process.env.REDIS_PREFIX || 'lobechat',
      REDIS_TLS: parseRedisTls(process.env.REDIS_TLS),
      REDIS_URL: process.env.REDIS_URL,
      REDIS_USERNAME: process.env.REDIS_USERNAME,
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    },
    server: {
      REDIS_DATABASE: z.number().int().optional(),
      REDIS_PASSWORD: z.string().optional(),
      REDIS_PREFIX: z.string(),
      REDIS_TLS: z.boolean().default(false),
      REDIS_URL: z.string().url().optional(),
      REDIS_USERNAME: z.string().optional(),
      UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
      UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    },
  });
};

export const redisEnv = getRedisEnv();

export const getUpstashRedisConfig = (): UpstashRedisConfig | null => {
  const upstashConfigSchema = z.union([
    z.object({
      token: z.string(),
      url: z.string().url(),
    }),
    z.object({
      token: z.undefined().optional(),
      url: z.undefined().optional(),
    }),
  ]);

  const parsed = upstashConfigSchema.safeParse({
    token: redisEnv.UPSTASH_REDIS_REST_TOKEN,
    url: redisEnv.UPSTASH_REDIS_REST_URL,
  });

  if (!parsed.success) throw parsed.error;
  if (!parsed.data.token || !parsed.data.url) return null;

  return parsed.data;
};

export const getRedisConfig = (): RedisConfig => {
  const prefix = redisEnv.REDIS_PREFIX;

  if (redisEnv.REDIS_URL) {
    return {
      database: redisEnv.REDIS_DATABASE,
      enabled: true,
      password: redisEnv.REDIS_PASSWORD,
      prefix,
      provider: 'redis',
      tls: redisEnv.REDIS_TLS,
      url: redisEnv.REDIS_URL,
      username: redisEnv.REDIS_USERNAME,
    };
  }

  const upstashConfig = getUpstashRedisConfig();
  if (upstashConfig) {
    return {
      enabled: true,
      prefix,
      provider: 'upstash',
      token: upstashConfig.token,
      url: upstashConfig.url,
    };
  }

  return {
    enabled: false,
    prefix,
    provider: false,
  };
};
