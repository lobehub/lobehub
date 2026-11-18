import {
  WIDGET_HTML_MAX_LENGTH,
  WIDGET_OUTPUT_TYPES,
  WIDGET_RUNTIMES,
} from '@lobechat/types/widget';
import { z } from 'zod';

import { widgetLayoutSchema, widgetSurfaceSchema } from './layout';
import { WIDGET_PARAM_LIMIT, widgetParamSchema } from './params';

/** Longest a widget script may run, in milliseconds. */
export const WIDGET_MAX_TIMEOUT_MS = 120_000;

/** Longest a widget script may be, in characters. */
export const WIDGET_SCRIPT_MAX_LENGTH = 256 * 1024;

/**
 * Validation of a widget version's manifest and view — the authored content
 * besides the script, shared by every entry point that records a draft and by
 * the preset contract, so all accept exactly the same content.
 */

// Both cases spelled out rather than an `i` flag: JSON Schema patterns carry no flags.
const envName = z.string().regex(/^[A-Z_a-z]\w*$/, 'env names must be valid shell identifiers');

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
          connector: z
            .string()
            .min(1)
            .optional()
            .describe("Connector supplying the credential, e.g. 'github'."),
          description: z.string().max(500).optional(),
          field: z
            .string()
            .min(1)
            .max(200)
            .optional()
            .describe('Header to read when the connector holds several, e.g. DD-API-KEY.'),
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
            .optional()
            .describe(
              "Where a Market connector's token is sent: the egress proxy sets `header` on requests to `host`.",
            ),
          name: envName.describe('Environment variable the script reads, e.g. GITHUB_TOKEN.'),
          required: z.boolean().optional(),
        }),
      )
      .max(20)
      .optional()
      .describe('Credentials the script reads from its environment, resolved from connectors.'),
    metric: z
      .object({
        key: z.string().min(1).max(100),
        kind: z.enum(['gauge', 'counter']).optional(),
        unit: z.string().max(50).optional(),
        valuePath: z.string().max(200).optional(),
      })
      .optional()
      .describe('Record the output as a metric on every published run, for a trend line.'),
    network: z
      .object({ allow: z.array(z.string().min(1).max(253)).max(50) })
      .optional()
      .describe('Hosts the sandbox may reach; omitted or empty means no network.'),
    params: z
      .array(widgetParamSchema)
      .max(WIDGET_PARAM_LIMIT)
      .optional()
      .describe('Plain-text settings a person fills in, exposed to the script as env vars.'),
    schedule: z
      .object({ pattern: z.string(), timezone: z.string().optional() })
      .optional()
      .describe('Suggested refresh cadence as a cron pattern, applied on publish.'),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(WIDGET_MAX_TIMEOUT_MS)
      .optional()
      .describe('Script time limit in milliseconds; defaults to 30000.'),
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
  html: z.string().min(1).max(WIDGET_HTML_MAX_LENGTH).optional(),
  layout: widgetLayoutSchema.optional(),
  limit: z.number().int().positive().max(500).optional(),
  size: z.enum(['sm', 'md', 'lg']).optional(),
  surface: widgetSurfaceSchema.optional(),
});

/** A widget's authored content: script, contract, manifest and view. */
export const widgetContentSchema = z.object({
  manifest: widgetManifestSchema.nullish(),
  outputType: z.enum(WIDGET_OUTPUT_TYPES).describe('The output document type stdout must match.'),
  runtime: z.enum(WIDGET_RUNTIMES).describe('Interpreter the sandbox runs the script with.'),
  script: z
    .string()
    .min(1)
    .max(WIDGET_SCRIPT_MAX_LENGTH)
    .describe('Source that prints one JSON output document to stdout.'),
  view: widgetViewSchema.nullish(),
});

/**
 * A widget version as a draft records it: the authored content plus an
 * optional note on what changed. Every entry point that saves a draft — the
 * tRPC router, the agent tool and the REST API — accepts exactly this.
 */
export const widgetVersionContentSchema = widgetContentSchema.extend({
  changeNote: z.string().max(500).nullish(),
});

/** What an author may send: a manifest as written, before defaults and stripping. */
export type WidgetManifestInput = z.input<typeof widgetManifestSchema>;
export type WidgetViewInput = z.input<typeof widgetViewSchema>;
export type WidgetContentInput = z.input<typeof widgetContentSchema>;
export type WidgetVersionContentInput = z.input<typeof widgetVersionContentSchema>;
/** What a parse returns: the content with unknown keys stripped. */
export type WidgetContent = z.output<typeof widgetContentSchema>;
export type WidgetVersionContent = z.output<typeof widgetVersionContentSchema>;
