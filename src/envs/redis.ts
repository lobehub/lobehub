/* eslint-disable sort-keys-fix/sort-keys-fix */
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

import { type RedisConfig } from '@/libs/redis';

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
    },
    server: {
      REDIS_DATABASE: z.number().int().optional(),
      REDIS_PASSWORD: z.string().optional(),
      REDIS_PREFIX: z.string(),
      REDIS_TLS: z.boolean().default(false),
      // NOTE: don't use z.string().url() because docker will pass empty string when not set
      REDIS_URL: z.string().optional(),
      REDIS_USERNAME: z.string().optional(),
    },
  });
};

export const redisEnv = getRedisEnv();

export const getRedisConfig = (): RedisConfig => {
  if (!redisEnv.REDIS_URL) {
    return {
      enabled: false,
      prefix: redisEnv.REDIS_PREFIX,
      tls: false,
      url: '',
    };
  }

  return {
    database: redisEnv.REDIS_DATABASE,
    enabled: true,
    password: redisEnv.REDIS_PASSWORD,
    prefix: redisEnv.REDIS_PREFIX,
    tls: redisEnv.REDIS_TLS,
    url: redisEnv.REDIS_URL,
    username: redisEnv.REDIS_USERNAME,
  };
};
