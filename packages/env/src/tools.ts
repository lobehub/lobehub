import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const optionalNumberEnv = (min: number, max: number) =>
  z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce.number().int().max(max).min(min).optional(),
  );

export const getToolsConfig = () => {
  return createEnv({
    runtimeEnv: {
      CRAWL_CONCURRENCY: process.env.CRAWL_CONCURRENCY,
      CRAWLER_RETRY: process.env.CRAWLER_RETRY,
      CRAWLER_IMPLS: process.env.CRAWLER_IMPLS,
      JINA_USE_CN_DOMAINS: process.env.JINA_USE_CN_DOMAINS,
      SEARCH_PROVIDERS: process.env.SEARCH_PROVIDERS,
      SEARXNG_URL: process.env.SEARXNG_URL,
      TOOL_NAME_MAX_LENGTH: process.env.TOOL_NAME_MAX_LENGTH,
      VISUAL_UNDERSTANDING_MODEL: process.env.VISUAL_UNDERSTANDING_MODEL,
      VISUAL_UNDERSTANDING_PROVIDER: process.env.VISUAL_UNDERSTANDING_PROVIDER,
    },

    server: {
      CRAWL_CONCURRENCY: optionalNumberEnv(1, 10),
      CRAWLER_RETRY: optionalNumberEnv(0, 3),
      CRAWLER_IMPLS: z.string().optional(),
      JINA_USE_CN_DOMAINS: z.enum(['true', 'false']).optional(),
      SEARCH_PROVIDERS: z.string().optional(),
      SEARXNG_URL: z.string().url().optional(),
      /**
       * Length at which a function-call tool name is compressed to an opaque
       * `MD5HASH_…` (OpenAI caps function names at 64). `0` disables
       * length-based compression entirely, keeping full readable tool names for
       * deployments whose models have no such limit. Defaults to 64.
       *
       * Deliberately kept as a raw string: `parseToolNameMaxLength`
       * (`@lobechat/const/plugin`) owns the parse, because `ToolNameResolver`
       * also reads this var straight from `process.env` on the server. Coercing
       * it here with different rules would let one env value mean two different
       * things — and would turn a typo into a thrown validation error that takes
       * the whole server config down, instead of falling back to the default.
       */
      TOOL_NAME_MAX_LENGTH: z.string().optional(),
      VISUAL_UNDERSTANDING_MODEL: z.string().optional(),
      VISUAL_UNDERSTANDING_PROVIDER: z.string().optional(),
    },
  });
};

export const toolsEnv = getToolsConfig();
