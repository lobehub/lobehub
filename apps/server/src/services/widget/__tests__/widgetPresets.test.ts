import {
  applyWidgetParamValues,
  BUILTIN_WIDGET_PRESETS,
  findBuiltinWidgetPreset,
  localizeWidgetPreset,
  missingWidgetParams,
  parseWidgetOutput,
  parseWidgetPreset,
  widgetManifestSchema,
  widgetParamEnv,
  widgetPresetSchema,
} from '@lobechat/widget-spec';
import { describe, expect, it } from 'vitest';

describe('bundled widget presets', () => {
  it.each(BUILTIN_WIDGET_PRESETS.map((preset) => [preset.id, preset]))(
    '%s is a valid, installable preset with a zh-CN translation',
    (_, preset) => {
      expect(() => parseWidgetPreset(preset)).not.toThrow();
      // the gallery sample is exactly what the script's contract accepts
      expect(parseWidgetOutput(JSON.stringify(preset.sample), preset.widget.outputType).ok).toBe(
        true,
      );
      expect(preset.locales?.['zh-CN']?.title).toBeTruthy();
      // installing with defaults alone leaves nothing required unset
      expect(missingWidgetParams(preset.widget.manifest?.params)).toEqual([]);
    },
  );

  it('have unique ids and can be found by id', () => {
    const ids = BUILTIN_WIDGET_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findBuiltinWidgetPreset('weather-now')?.category).toBe('weather');
    expect(findBuiltinWidgetPreset('nope')).toBeUndefined();
  });
});

describe('widgetPresetSchema', () => {
  const base = BUILTIN_WIDGET_PRESETS.find((preset) => preset.id === 'countdown')!;

  it('rejects a sample of another output type and a data preset without a layout', () => {
    const issues = (input: unknown) =>
      (widgetPresetSchema.safeParse(input).error?.issues ?? [])
        .map((issue) => issue.message)
        .join('\n');

    expect(issues({ ...base, sample: { type: 'stat', value: 1 } })).toContain('sample is "stat"');
    expect(issues({ ...base, widget: { ...base.widget, view: {} } })).toContain(
      'needs view.layout',
    );
    expect(
      issues({ ...base, locales: { 'zh-CN': { params: { NOPE: { label: 'x' } } } } }),
    ).toContain('unknown param "NOPE"');
  });

  it('localizes gallery copy with an English fallback', () => {
    const zh = localizeWidgetPreset(base, 'zh-CN');
    expect(zh.title).toBe('倒数日');
    expect(zh.params.find((param) => param.name === 'DATE')?.label).toBe('日期');

    const de = localizeWidgetPreset(base, 'de-DE');
    expect(de.title).toBe('Countdown');
    expect(de.params.find((param) => param.name === 'TIMEZONE')?.label).toBe('Time zone');
  });
});

describe('widget params', () => {
  const params = [
    { name: 'CITY', required: true, type: 'string' as const },
    { default: 8, name: 'LIMIT', type: 'number' as const },
    { name: 'DATE', type: 'date' as const },
    { name: 'UNIT', options: [{ value: 'c' }, { value: 'f' }], type: 'select' as const },
  ];

  it('reports required params without a value, and fills values by name', () => {
    expect(missingWidgetParams(params).map((param) => param.name)).toEqual(['CITY']);

    const filled = applyWidgetParamValues(params, { CITY: 'Paris', IGNORED: 'x', UNIT: 'f' });
    expect(missingWidgetParams(filled)).toEqual([]);
    expect(widgetParamEnv(filled)).toEqual({ CITY: 'Paris', LIMIT: '8', UNIT: 'f' });
  });

  it.each([
    [{ LIMIT: 'eight' }, 'LIMIT must be a number'],
    [{ DATE: '2027/01/01' }, 'DATE must be a YYYY-MM-DD date'],
    [{ UNIT: 'k' }, 'UNIT must be one of the options'],
  ])('rejects %j', (values, message) => {
    expect(() => applyWidgetParamValues(params, values)).toThrow(message);
  });

  it('are validated in the manifest: typed values, unique names, no clash with secrets', () => {
    const parse = (manifest: unknown) => widgetManifestSchema.safeParse(manifest);

    expect(parse({ params: [{ default: 'x', name: 'LIMIT', type: 'number' }] }).success).toBe(
      false,
    );
    expect(parse({ params: [{ name: 'city', type: 'string' }] }).success).toBe(false);
    expect(parse({ params: [{ name: 'MODE', type: 'select' }] }).success).toBe(false);
    expect(
      parse({
        params: [
          { name: 'A', type: 'string' },
          { name: 'A', type: 'string' },
        ],
      }).success,
    ).toBe(false);
    expect(
      parse({
        env: [{ connector: 'github', name: 'GITHUB_TOKEN' }],
        params: [{ name: 'GITHUB_TOKEN', type: 'string' }],
      }).success,
    ).toBe(false);
    expect(parse({ params: [{ default: '2027-01-01', name: 'DATE', type: 'date' }] }).success).toBe(
      true,
    );
  });
});
