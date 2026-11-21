import { findBuiltinWidgetPreset } from '@lobechat/widget-spec';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardExecutionRuntime, type DashboardToolService } from './index';

const createWidgetDraft = vi.fn();
let runtime: DashboardExecutionRuntime;

beforeEach(() => {
  createWidgetDraft.mockReset();
  createWidgetDraft.mockResolvedValue({
    version: {
      id: 'v1',
      outputType: 'data',
      runtime: 'node',
      script: 's',
      status: 'draft',
      version: 1,
    },
    widgetId: 'w1',
  });
  runtime = new DashboardExecutionRuntime({ createWidgetDraft } as unknown as DashboardToolService);
});

describe('listWidgetPresets', () => {
  it('lists presets with their settings, optionally by category', async () => {
    const all = await runtime.listWidgetPresets();
    expect(all.content).toContain('weather-now [weather]');
    expect(all.content).toContain('CITY (string, required, default "London")');
    expect(all.content).toContain('LANGUAGE (select one of en|zh|ja|de|fr|es');

    const time = await runtime.listWidgetPresets({ category: 'time' });
    expect((time.state as any).presets.map((p: { id: string }) => p.id)).toEqual([
      'countdown',
      'year-progress',
    ]);
  });
});

describe('createWidgetDraft from a preset', () => {
  it('installs the preset content with the given params and its own title', async () => {
    const result = await runtime.createWidgetDraft({
      params: { CITY: 'Hangzhou', LANGUAGE: 'zh' },
      presetId: 'weather-now',
    });

    const preset = findBuiltinWidgetPreset('weather-now')!;
    const call = createWidgetDraft.mock.calls[0][0];
    expect(result.success).toBe(true);
    expect(result.content).toContain('from preset weather-now');
    expect(call.title).toBe(preset.title);
    expect(call.description).toBe(preset.description);
    expect(call.content.script).toBe(preset.widget.script);
    expect(call.content.view).toEqual(preset.widget.view);
    expect(call.content.manifest.params).toEqual([
      expect.objectContaining({ name: 'CITY', value: 'Hangzhou' }),
      expect.objectContaining({ name: 'LANGUAGE', value: 'zh' }),
    ]);
  });

  it('lets explicit fields override the preset', async () => {
    await runtime.createWidgetDraft({ presetId: 'countdown', title: 'Launch day' });

    expect(createWidgetDraft.mock.calls[0][0].title).toBe('Launch day');
  });

  it('refuses an unknown preset, a param value of the wrong type and a draft with nothing to install', async () => {
    const unknown = await runtime.createWidgetDraft({ presetId: 'nope' });
    expect(unknown.success).toBe(false);
    expect(unknown.content).toContain('Unknown preset "nope"');

    const badValue = await runtime.createWidgetDraft({
      params: { DATE: 'next friday' },
      presetId: 'countdown',
    });
    expect(badValue.success).toBe(false);
    expect(badValue.content).toContain('DATE must be a YYYY-MM-DD date');

    const empty = await runtime.createWidgetDraft({ title: 'x' });
    expect(empty.success).toBe(false);
    expect(createWidgetDraft).not.toHaveBeenCalled();
  });
});
