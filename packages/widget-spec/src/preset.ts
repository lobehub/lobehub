import type { WidgetPreset } from '@lobechat/types';
import { WIDGET_PRESET_CATEGORIES } from '@lobechat/types';
import { z } from 'zod';

import { widgetContentSchema } from './manifest';
import { widgetOutputSchema } from './output';

const localeCopy = z.object({
  description: z.string().max(500).optional(),
  params: z
    .record(
      z.string(),
      z.object({
        description: z.string().max(500).optional(),
        label: z.string().max(100).optional(),
      }),
    )
    .optional(),
  title: z.string().max(100).optional(),
});

/**
 * Validation of a widget preset — what the gallery lists and what installing
 * turns into a widget. Beyond each field, a preset must be installable as is:
 * its sample is the output type it declares, a `data` preset brings its
 * layout, and every required param has a default or is left for the person
 * installing it to fill in.
 */
export const widgetPresetSchema = z
  .object({
    category: z.enum(WIDGET_PRESET_CATEGORIES),
    contract: z
      .string()
      .regex(/^[a-z][\da-z-]*\.v\d+$/, 'contracts look like weather.v1')
      .optional(),
    description: z.string().min(1).max(500),
    id: z
      .string()
      .regex(/^[a-z][\da-z]*(?:-[\da-z]+)*$/, 'preset ids are kebab-case')
      .max(64),
    locales: z.record(z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/), localeCopy).optional(),
    sample: widgetOutputSchema,
    size: z
      .object({ h: z.number().int().min(2).max(12), w: z.number().int().min(1).max(12) })
      .optional(),
    tags: z.array(z.string().max(40)).max(10).optional(),
    title: z.string().min(1).max(100),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'versions are semver, e.g. 1.0.0'),
    widget: widgetContentSchema,
  })
  .superRefine((preset, ctx) => {
    if (preset.sample.type !== preset.widget.outputType) {
      ctx.addIssue({
        code: 'custom',
        message: `sample is "${preset.sample.type}" but the widget prints "${preset.widget.outputType}"`,
        path: ['sample', 'type'],
      });
    }
    if (preset.widget.outputType === 'data' && !preset.widget.view?.layout) {
      ctx.addIssue({
        code: 'custom',
        message: 'a data preset needs view.layout to draw its card',
        path: ['widget', 'view', 'layout'],
      });
    }
    const params = new Set((preset.widget.manifest?.params ?? []).map((param) => param.name));
    for (const [locale, copy] of Object.entries(preset.locales ?? {})) {
      for (const name of Object.keys(copy.params ?? {})) {
        if (!params.has(name)) {
          ctx.addIssue({
            code: 'custom',
            message: `locale ${locale} labels unknown param "${name}"`,
            path: ['locales', locale, 'params', name],
          });
        }
      }
    }
  });

/** Parse a preset, or throw with every problem listed. */
export const parseWidgetPreset = (input: unknown): WidgetPreset => {
  const result = widgetPresetSchema.safeParse(input);
  if (!result.success) throw new Error(`Invalid widget preset: ${z.prettifyError(result.error)}`);
  return result.data as WidgetPreset;
};

/** Gallery copy of a preset in a locale, falling back to its English fields. */
export const localizeWidgetPreset = (preset: WidgetPreset, locale?: string) => {
  const copy =
    (locale && (preset.locales?.[locale] ?? preset.locales?.[locale.split('-')[0]])) || {};
  return {
    description: copy.description ?? preset.description,
    params: (preset.widget.manifest?.params ?? []).map((param) => ({
      ...param,
      description: copy.params?.[param.name]?.description ?? param.description,
      label: copy.params?.[param.name]?.label ?? param.label ?? param.name,
    })),
    title: copy.title ?? preset.title,
  };
};
