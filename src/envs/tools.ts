import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const BROWSERLESS_WAIT_UNTIL_VALUES = [
  'load',
  'domcontentloaded',
  'networkidle0',
  'networkidle2',
] as const;

const optionalNumberEnv = (min: number, max: number) =>
  z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce.number().int().max(max).min(min).optional(),
  );

export const getToolsConfig = () => {
  return createEnv({
    runtimeEnv: {
      BROWSERLESS_WAIT_UNTIL: process.env.BROWSERLESS_WAIT_UNTIL,
      CRAWLER_TIMEOUT: process.env.CRAWLER_TIMEOUT,
      CRAWL_CONCURRENCY: process.env.CRAWL_CONCURRENCY,
      CRAWLER_RETRY: process.env.CRAWLER_RETRY,
      CRAWLER_IMPLS: process.env.CRAWLER_IMPLS,
      JINA_USE_CN_DOMAINS: process.env.JINA_USE_CN_DOMAINS,
      SEARCH_PROVIDERS: process.env.SEARCH_PROVIDERS,
      SEARXNG_URL: process.env.SEARXNG_URL,
      VISUAL_UNDERSTANDING_MODEL: process.env.VISUAL_UNDERSTANDING_MODEL,
      VISUAL_UNDERSTANDING_PROVIDER: process.env.VISUAL_UNDERSTANDING_PROVIDER,
    },

    server: {
      BROWSERLESS_WAIT_UNTIL: z.enum(BROWSERLESS_WAIT_UNTIL_VALUES).optional(),
      CRAWL_CONCURRENCY: optionalNumberEnv(1, 10),
      CRAWLER_RETRY: optionalNumberEnv(0, 3),
      CRAWLER_IMPLS: z.string().optional(),
      CRAWLER_TIMEOUT: optionalNumberEnv(1000, 300_000),
      JINA_USE_CN_DOMAINS: z.enum(['true', 'false']).optional(),
      SEARCH_PROVIDERS: z.string().optional(),
      SEARXNG_URL: z.string().url().optional(),
      VISUAL_UNDERSTANDING_MODEL: z.string().optional(),
      VISUAL_UNDERSTANDING_PROVIDER: z.string().optional(),
    },
  });
};

export const toolsEnv = getToolsConfig();
