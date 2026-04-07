import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const LANGFUSE_TRACE_DATA_OPTIONS = ['userId', 'email'] as const;

export type LangfuseTraceDataValue = (typeof LANGFUSE_TRACE_DATA_OPTIONS)[number];

export interface LangfuseTraceDataMap {
  userId: LangfuseTraceDataValue;
}

const DEFAULT_LANGFUSE_TRACE_DATA: LangfuseTraceDataMap = {
  userId: 'userId',
};

const parseLangfuseTraceData = (traceData?: string): LangfuseTraceDataMap => {
  if (!traceData) return DEFAULT_LANGFUSE_TRACE_DATA;

  const parsed = new Map<string, LangfuseTraceDataValue>();
  const items = traceData.split(';').filter(Boolean);

  for (const item of items) {
    const [rawField = '', rawMappedValue = ''] = item.split(':');
    const field = rawField.trim();
    const mappedValue = rawMappedValue.trim();

    if (field !== 'userId') continue;
    if (!LANGFUSE_TRACE_DATA_OPTIONS.includes(mappedValue as LangfuseTraceDataValue)) continue;

    parsed.set(field, mappedValue as LangfuseTraceDataValue);
  }

  return {
    ...DEFAULT_LANGFUSE_TRACE_DATA,
    ...Object.fromEntries(parsed.entries()),
  };
};

export const getLangfuseConfig = () => {
  const env = createEnv({
    runtimeEnv: {
      ENABLE_LANGFUSE: process.env.ENABLE_LANGFUSE === '1',
      LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY || '',
      LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY || '',
      LANGFUSE_HOST: process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com',
    },

    server: {
      ENABLE_LANGFUSE: z.boolean(),
      LANGFUSE_SECRET_KEY: z.string().optional(),
      LANGFUSE_PUBLIC_KEY: z.string().optional(),
      LANGFUSE_HOST: z.string().url(),
    },
  });

  return {
    ...env,
    LANGFUSE_TRACE_DATA: parseLangfuseTraceData(process.env.LANGFUSE_TRACE_DATA),
  };
};

export const langfuseEnv = getLangfuseConfig();
