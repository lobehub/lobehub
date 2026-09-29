import type { WidgetOutput, WidgetOutputType } from '@lobechat/types';
import { z } from 'zod';

/** Upper bounds a widget output must stay within; anything larger is rejected, not clipped. */
export const WIDGET_OUTPUT_LIMITS = {
  /** UTF-8 size of the JSON document on stdout. */
  bytes: 256 * 1024,
  listItems: 200,
  pointsPerSeries: 1000,
  series: 20,
  tableColumns: 30,
  tableRows: 500,
} as const;

const text = z.string().max(2000);
const shortText = z.string().max(200);
const scalar = z.union([z.number().finite(), text]);

const metaSchema = z
  .object({ complete: z.boolean().optional(), message: text.optional() })
  .optional();

const statSchema = z.object({
  delta: scalar.optional(),
  description: text.optional(),
  label: shortText.optional(),
  meta: metaSchema,
  trend: z.enum(['up', 'down', 'flat']).optional(),
  type: z.literal('stat'),
  unit: shortText.optional(),
  value: scalar,
});

const listSchema = z.object({
  items: z
    .array(
      z.object({
        description: text.optional(),
        status: shortText.optional(),
        time: shortText.optional(),
        title: text,
        url: text.optional(),
        value: scalar.optional(),
      }),
    )
    .max(WIDGET_OUTPUT_LIMITS.listItems),
  meta: metaSchema,
  type: z.literal('list'),
});

const seriesSchema = z.object({
  meta: metaSchema,
  series: z
    .array(
      z.object({
        name: shortText,
        points: z
          .array(z.object({ t: shortText, v: z.number().finite() }))
          .max(WIDGET_OUTPUT_LIMITS.pointsPerSeries),
      }),
    )
    .max(WIDGET_OUTPUT_LIMITS.series),
  type: z.literal('series'),
  unit: shortText.optional(),
});

const cell = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]);

const tableSchema = z
  .object({
    columns: z
      .array(
        z.object({
          key: shortText,
          title: shortText.optional(),
          type: z.enum(['string', 'number', 'date', 'link']).optional(),
        }),
      )
      .min(1)
      .max(WIDGET_OUTPUT_LIMITS.tableColumns),
    meta: metaSchema,
    rows: z.array(z.record(z.string(), cell)).max(WIDGET_OUTPUT_LIMITS.tableRows),
    type: z.literal('table'),
  })
  .superRefine((value, ctx) => {
    const keys = new Set(value.columns.map((c) => c.key));
    if (keys.size !== value.columns.length) {
      ctx.addIssue({ code: 'custom', message: 'column keys must be unique', path: ['columns'] });
    }
  });

const outputSchema = z.discriminatedUnion('type', [
  statSchema,
  listSchema,
  seriesSchema,
  tableSchema,
]);

export type WidgetOutputErrorCode =
  'EMPTY_OUTPUT' | 'INVALID_JSON' | 'INVALID_OUTPUT' | 'OUTPUT_TOO_LARGE' | 'OUTPUT_TYPE_MISMATCH';

export type ParseWidgetOutputResult =
  | { ok: true; output: WidgetOutput; partial: boolean; partialMessage?: string }
  | { code: WidgetOutputErrorCode; message: string; ok: false };

const fail = (code: WidgetOutputErrorCode, message: string): ParseWidgetOutputResult => ({
  code,
  message,
  ok: false,
});

/**
 * The document is normally the whole stdout. Scripts that log before printing
 * the result are tolerated as long as the last non-empty line is the JSON.
 */
const extractJson = (stdout: string): unknown => {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split('\n').filter((line) => line.trim());
    const last = lines.at(-1);
    if (!last || lines.length === 1) throw new Error('not JSON');
    return JSON.parse(last);
  }
};

/**
 * Check a script's stdout against the widget output contract (stat / list /
 * series / table) and the version's declared output type.
 *
 * `meta.complete === false` is accepted and reported as `partial`: the run
 * still succeeds, but callers must not treat the numbers as a full sample.
 */
export const parseWidgetOutput = (
  stdout: string,
  expectedType?: WidgetOutputType,
): ParseWidgetOutputResult => {
  if (!stdout || !stdout.trim()) {
    return fail('EMPTY_OUTPUT', 'Script printed nothing to stdout; expected one JSON document');
  }

  const bytes = Buffer.byteLength(stdout, 'utf8');
  if (bytes > WIDGET_OUTPUT_LIMITS.bytes) {
    return fail(
      'OUTPUT_TOO_LARGE',
      `Output is ${bytes} bytes; the limit is ${WIDGET_OUTPUT_LIMITS.bytes} bytes`,
    );
  }

  let raw: unknown;
  try {
    raw = extractJson(stdout);
  } catch {
    return fail('INVALID_JSON', 'stdout is not a JSON document');
  }

  const parsed = outputSchema.safeParse(raw);
  if (!parsed.success) {
    const tooBig = parsed.error.issues.some((issue) => issue.code === 'too_big');
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return fail(
      tooBig ? 'OUTPUT_TOO_LARGE' : 'INVALID_OUTPUT',
      `Output does not match the widget contract: ${detail}`,
    );
  }

  const output = parsed.data as WidgetOutput;
  if (expectedType && output.type !== expectedType) {
    return fail(
      'OUTPUT_TYPE_MISMATCH',
      `Output type "${output.type}" does not match the declared type "${expectedType}"`,
    );
  }

  const partial = output.meta?.complete === false;
  return { ok: true, output, partial, partialMessage: partial ? output.meta?.message : undefined };
};
