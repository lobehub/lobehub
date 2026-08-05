import { describe, expect, it } from 'vitest';

import enUSModels from '../../../locales/en-US/models.json';
import zhCNModels from '../../../locales/zh-CN/models.json';
import { lobeHubOnlineModelDescriptions } from './lobehubOnlineModelDescriptions';

const addedDescriptionKeys = [
  'lobehub.gemini-3.1-flash-image.description',
  'lobehub.gemini-3.1-flash-image:image.description',
  'lobehub.qwen3.8-max.description',
] as const;

describe('LobeHub online model descriptions', () => {
  it.each(addedDescriptionKeys)('ships English and Chinese translations for %s', (key) => {
    expect(enUSModels[key]).toBe(lobeHubOnlineModelDescriptions[key]);
    expect(zhCNModels[key]).toMatch(/[\u3400-\u9FFF]/u);
  });
});
