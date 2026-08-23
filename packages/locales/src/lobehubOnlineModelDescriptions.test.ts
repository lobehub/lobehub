import { describe, expect, it } from 'vitest';

import enUSModels from '../../../locales/en-US/models.json';
import zhCNModels from '../../../locales/zh-CN/models.json';
import { lobeHubOnlineModelDescriptions } from './lobehubOnlineModelDescriptions';

const enUSDescriptions = enUSModels as Record<string, string>;
const zhCNDescriptions = zhCNModels as Record<string, string>;

const addedDescriptionKeys = [
  'lobehub.deepseek-v4-flash-vision-exp.description',
  'lobehub.gemini-3.1-flash-image.description',
  'lobehub.gemini-3.1-flash-image:image.description',
  'lobehub.gemini-3.7-flash.description',
  'lobehub.qwen3.8-max.description',
  'lobehub.grok-4.6.description',
] as const;

describe('LobeHub online model descriptions', () => {
  it.each(addedDescriptionKeys)('ships English and Chinese translations for %s', (key) => {
    expect(enUSDescriptions[key]).toBe(lobeHubOnlineModelDescriptions[key]);
    expect(zhCNDescriptions[key]).toMatch(/[\u3400-\u9FFF]/u);
  });

  it.each([
    ['gemini-3.1-flash-image.description', 'gemini-3.1-flash-image-preview.description'],
    [
      'gemini-3.1-flash-image:image.description',
      'gemini-3.1-flash-image-preview:image.description',
    ],
  ])('ships the stable Google translation for %s', (stableKey, previewKey) => {
    expect(enUSDescriptions[stableKey]).toBe(enUSDescriptions[previewKey]);
    expect(zhCNDescriptions[stableKey]).toBe(zhCNDescriptions[previewKey]);
  });
});
