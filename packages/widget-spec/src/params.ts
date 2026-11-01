import type { WidgetParam, WidgetParamValue } from '@lobechat/types';
import { WIDGET_PARAM_TYPES } from '@lobechat/types';
import { z } from 'zod';

/** Most params one widget declares. */
export const WIDGET_PARAM_LIMIT = 20;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const paramValue = z.union([z.string().max(500), z.number().finite(), z.boolean()]);

/** Why `value` does not fit a param of this type, or undefined when it does. */
export const widgetParamValueIssue = (
  param: Pick<WidgetParam, 'options' | 'type'>,
  value: WidgetParamValue,
): string | undefined => {
  switch (param.type) {
    case 'number': {
      return typeof value === 'number' ? undefined : 'must be a number';
    }
    case 'boolean': {
      return typeof value === 'boolean' ? undefined : 'must be true or false';
    }
    case 'date': {
      return typeof value === 'string' && DATE.test(value)
        ? undefined
        : 'must be a YYYY-MM-DD date';
    }
    case 'select': {
      return param.options?.some((option) => option.value === value)
        ? undefined
        : 'must be one of the options';
    }
    default: {
      return typeof value === 'string' ? undefined : 'must be text';
    }
  }
};

export const widgetParamSchema = z
  .object({
    default: paramValue.optional(),
    description: z.string().max(500).optional(),
    label: z.string().max(100).optional(),
    name: z
      .string()
      .regex(/^[A-Z][\dA-Z_]*$/, 'param names are UPPER_SNAKE_CASE env names, e.g. CITY')
      .max(64),
    options: z
      .array(z.object({ label: z.string().max(100).optional(), value: z.string().max(200) }))
      .min(1)
      .max(50)
      .optional(),
    required: z.boolean().optional(),
    type: z.enum(WIDGET_PARAM_TYPES),
    value: paramValue.optional(),
  })
  .superRefine((param, ctx) => {
    if (param.type === 'select' && !param.options) {
      ctx.addIssue({ code: 'custom', message: 'a select param needs options', path: ['options'] });
    }
    for (const key of ['default', 'value'] as const) {
      const value = param[key];
      if (value === undefined) continue;
      const issue = widgetParamValueIssue(param, value);
      if (issue) ctx.addIssue({ code: 'custom', message: `${key} ${issue}`, path: [key] });
    }
  });

/** The effective value: this widget's choice, else the default. */
export const widgetParamValue = (param: WidgetParam): WidgetParamValue | undefined =>
  param.value ?? param.default;

/** Required params that have neither a value nor a default. */
export const missingWidgetParams = (params: WidgetParam[] = []): WidgetParam[] =>
  params.filter((param) => param.required && widgetParamValue(param) === undefined);

/**
 * The params as the script's environment: each set param under its name,
 * as text. Params are settings, not secrets, so they are kept apart from the
 * credential env and are never redacted from logs.
 */
export const widgetParamEnv = (params: WidgetParam[] = []): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const param of params) {
    const value = widgetParamValue(param);
    if (value !== undefined) env[param.name] = String(value);
  }
  return env;
};

/**
 * Fill params with values, e.g. what a person typed when installing a preset.
 * Unknown names are ignored; values that do not fit their param are rejected.
 */
export const applyWidgetParamValues = (
  params: WidgetParam[] = [],
  values: Record<string, WidgetParamValue> = {},
): WidgetParam[] =>
  params.map((param) => {
    if (!(param.name in values)) return param;
    const value = values[param.name];
    const issue = widgetParamValueIssue(param, value);
    if (issue) throw new Error(`Param ${param.name} ${issue}`);
    return { ...param, value };
  });
