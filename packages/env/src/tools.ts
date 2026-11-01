import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const optionalNumberEnv = (min: number, max: number) =>
  z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce.number().int().max(max).min(min).optional(),
  );

const SUPPORTED_MULTIMODAL_IMAGE_FORMATS = ['image/jpeg', 'image/png', 'image/webp'] as const;
const DEFAULT_MULTIMODAL_IMAGE_FORMATS = SUPPORTED_MULTIMODAL_IMAGE_FORMATS.slice(0, 2);
const MULTIMODAL_IMAGE_FORMAT_ALIASES: Record<
  string,
  (typeof SUPPORTED_MULTIMODAL_IMAGE_FORMATS)[number]
> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'jpeg': 'image/jpeg',
  'jpg': 'image/jpeg',
  'png': 'image/png',
  'webp': 'image/webp',
};

const multimodalImageFormatsEnv = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;

    const formats = value
      .split(',')
      .map((format) => {
        const normalizedFormat = format.trim().toLowerCase();
        return MULTIMODAL_IMAGE_FORMAT_ALIASES[normalizedFormat] ?? normalizedFormat;
      })
      .filter(Boolean);

    return formats.length > 0 ? [...new Set(formats)] : undefined;
  },
  z
    .array(z.enum(SUPPORTED_MULTIMODAL_IMAGE_FORMATS))
    .min(1)
    .default([...DEFAULT_MULTIMODAL_IMAGE_FORMATS]),
);

export const getToolsConfig = () => {
  /**
   * Keep the visual-understanding variables as migration fallbacks while
   * exposing only the canonical multimodal configuration to consumers.
   */
  const multimodalUnderstandingModel =
    process.env.MULTIMODAL_UNDERSTANDING_MODEL ?? process.env.VISUAL_UNDERSTANDING_MODEL;
  const multimodalUnderstandingProvider =
    process.env.MULTIMODAL_UNDERSTANDING_PROVIDER ?? process.env.VISUAL_UNDERSTANDING_PROVIDER;

  return createEnv({
    runtimeEnv: {
      CRAWL_CONCURRENCY: process.env.CRAWL_CONCURRENCY,
      CRAWLER_RETRY: process.env.CRAWLER_RETRY,
      CRAWLER_IMPLS: process.env.CRAWLER_IMPLS,
      JINA_USE_CN_DOMAINS: process.env.JINA_USE_CN_DOMAINS,
      MULTIMODAL_UNDERSTANDING_IMAGE_FORMATS: process.env.MULTIMODAL_UNDERSTANDING_IMAGE_FORMATS,
      SEARCH_PROVIDERS: process.env.SEARCH_PROVIDERS,
      SEARXNG_URL: process.env.SEARXNG_URL,
      TOOL_NAME_MAX_LENGTH: process.env.TOOL_NAME_MAX_LENGTH,
      MULTIMODAL_UNDERSTANDING_MODEL: multimodalUnderstandingModel,
      MULTIMODAL_UNDERSTANDING_PROVIDER: multimodalUnderstandingProvider,
    },

    server: {
      CRAWL_CONCURRENCY: optionalNumberEnv(1, 10),
      CRAWLER_RETRY: optionalNumberEnv(0, 3),
      CRAWLER_IMPLS: z.string().optional(),
      JINA_USE_CN_DOMAINS: z.enum(['true', 'false']).optional(),
      MULTIMODAL_UNDERSTANDING_IMAGE_FORMATS: multimodalImageFormatsEnv,
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
      MULTIMODAL_UNDERSTANDING_MODEL: z.string().optional(),
      MULTIMODAL_UNDERSTANDING_PROVIDER: z.string().optional(),
    },
  });
};

export const toolsEnv = getToolsConfig();
