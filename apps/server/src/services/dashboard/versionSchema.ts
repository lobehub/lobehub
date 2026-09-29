import { DASHBOARD_WIDGET_RUNTIMES, WIDGET_OUTPUT_TYPES } from '@lobechat/types';
import { z } from 'zod';

import { DASHBOARD_SANDBOX_MAX_TIMEOUT_MS } from './sandboxRunner';

/**
 * Validation of a widget version's authored content, shared by the TRPC
 * router and the agent tool runtime so both accept exactly the same drafts.
 */

const envName = z.string().regex(/^[A-Z_]\w*$/i, 'env names must be valid shell identifiers');

export const widgetManifestSchema = z.object({
  description: z.string().max(2000).optional(),
  env: z
    .array(
      z.object({
        connector: z.string().min(1).optional(),
        description: z.string().max(500).optional(),
        name: envName,
        required: z.boolean().optional(),
      }),
    )
    .max(20)
    .optional(),
  metric: z
    .object({
      key: z.string().min(1).max(100),
      kind: z.enum(['gauge', 'counter']).optional(),
      unit: z.string().max(50).optional(),
      valuePath: z.string().max(200).optional(),
    })
    .optional(),
  network: z.object({ allow: z.array(z.string().min(1).max(253)).max(50) }).optional(),
  schedule: z.object({ pattern: z.string(), timezone: z.string().optional() }).optional(),
  timeoutMs: z.number().int().positive().max(DASHBOARD_SANDBOX_MAX_TIMEOUT_MS).optional(),
  title: z.string().max(200).optional(),
});

export const widgetViewSchema = z.object({
  chart: z.enum(['line', 'bar', 'area']).optional(),
  columns: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(500).optional(),
  size: z.enum(['sm', 'md', 'lg']).optional(),
});

export const widgetVersionContentSchema = z.object({
  changeNote: z.string().max(500).nullish(),
  manifest: widgetManifestSchema.nullish(),
  outputType: z.enum(WIDGET_OUTPUT_TYPES),
  runtime: z.enum(DASHBOARD_WIDGET_RUNTIMES),
  script: z
    .string()
    .min(1)
    .max(256 * 1024),
  view: widgetViewSchema.nullish(),
});
