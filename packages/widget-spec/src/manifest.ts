import { WIDGET_OUTPUT_TYPES, WIDGET_RUNTIMES } from '@lobechat/types';
import { z } from 'zod';

import { widgetLayoutSchema, widgetSurfaceSchema } from './layout';
import { WIDGET_PARAM_LIMIT, widgetParamSchema } from './params';

/** Longest a widget script may run, in milliseconds. */
export const WIDGET_MAX_TIMEOUT_MS = 120_000;

/**
 * Validation of a widget version's manifest and view — the authored content
 * besides the script, shared by every entry point that records a draft and by
 * the preset contract, so all accept exactly the same content.
 */

const envName = z.string().regex(/^[A-Z_]\w*$/i, 'env names must be valid shell identifiers');

/** A hostname, or `*.domain` for its subdomains — the form `network.allow` takes. */
const hostPattern = z
  .string()
  .min(1)
  .max(253)
  .regex(
    /^(?:\*\.)?[\w-]+(?:\.[\w-]+)+$/,
    'hosts must be a hostname or *.domain, without scheme or path',
  );

export const widgetManifestSchema = z
  .object({
    description: z.string().max(2000).optional(),
    env: z
      .array(
        z.object({
          connector: z.string().min(1).optional(),
          description: z.string().max(500).optional(),
          field: z.string().min(1).max(200).optional(),
          inject: z
            .object({
              header: z
                .string()
                .regex(/^[!#$%&'*+.^`|~\w-]+$/, 'inject.header must be a valid header name')
                .max(100)
                .optional(),
              host: z.union([hostPattern, z.array(hostPattern).min(1).max(5)]),
              prefix: z
                .string()
                .max(100)
                .regex(/^[^\0\n\r]*$/, 'inject.prefix must be a single line')
                .optional(),
            })
            .optional(),
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
    params: z.array(widgetParamSchema).max(WIDGET_PARAM_LIMIT).optional(),
    schedule: z.object({ pattern: z.string(), timezone: z.string().optional() }).optional(),
    timeoutMs: z.number().int().positive().max(WIDGET_MAX_TIMEOUT_MS).optional(),
    title: z.string().max(200).optional(),
  })
  .superRefine((manifest, ctx) => {
    const params = manifest.params ?? [];
    const secretNames = new Set((manifest.env ?? []).map((env) => env.name));
    const seen = new Set<string>();
    params.forEach((param, index) => {
      if (seen.has(param.name)) {
        ctx.addIssue({
          code: 'custom',
          message: `param "${param.name}" is declared twice`,
          path: ['params', index, 'name'],
        });
      }
      seen.add(param.name);
      if (secretNames.has(param.name)) {
        ctx.addIssue({
          code: 'custom',
          message: `param "${param.name}" has the same name as an env requirement`,
          path: ['params', index, 'name'],
        });
      }
    });
  });

export const widgetViewSchema = z.object({
  chart: z.enum(['line', 'bar', 'area']).optional(),
  columns: z.array(z.string()).optional(),
  layout: widgetLayoutSchema.optional(),
  limit: z.number().int().positive().max(500).optional(),
  size: z.enum(['sm', 'md', 'lg']).optional(),
  surface: widgetSurfaceSchema.optional(),
});

/** A widget's authored content: script, contract, manifest and view. */
export const widgetContentSchema = z.object({
  manifest: widgetManifestSchema.nullish(),
  outputType: z.enum(WIDGET_OUTPUT_TYPES),
  runtime: z.enum(WIDGET_RUNTIMES),
  script: z
    .string()
    .min(1)
    .max(256 * 1024),
  view: widgetViewSchema.nullish(),
});
