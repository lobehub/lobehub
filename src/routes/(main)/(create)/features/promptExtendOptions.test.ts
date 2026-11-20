import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';
import { describe, expect, it } from 'vitest';

import image from '@/locales/default/image';
import video from '@/locales/default/video';

const localeByType: Record<string, Record<string, string>> = { image, video };

/**
 * The prompt-extend tabs render each enum value through `config.promptExtend.options.<value>`,
 * so every value a model declares needs a label in its generation namespace.
 */
describe('promptExtend option labels', () => {
  const cases = LOBE_DEFAULT_MODEL_LIST.flatMap((model) => {
    const locale = localeByType[model.type];
    const values = (model as { parameters?: { promptExtend?: { enum?: string[] } } }).parameters
      ?.promptExtend?.enum;
    if (!locale || !values) return [];

    return values.map((value) => ({ locale, model: `${model.providerId}/${model.id}`, value }));
  });

  it('covers at least one enum-based model', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)('$model: $value has a label', ({ locale, value }) => {
    expect(locale[`config.promptExtend.options.${value}`]).toBeTruthy();
  });
});
