import { describe, expect, it } from 'vitest';

import enUSModels from '../../../locales/en-US/models.json';
import zhCNModels from '../../../locales/zh-CN/models.json';
import { modelDescriptionOverrides } from './modelDescriptionOverrides';

describe('modelDescriptionOverrides', () => {
  it('warns Qwen3.8 Max Preview users about the Token Plan endpoint requirements', () => {
    const key = 'qwen3.8-max-preview.description';

    expect(modelDescriptionOverrides[key]).toBe(enUSModels[key]);
    expect(enUSModels[key]).toContain('Token Plan API key');
    expect(enUSModels[key]).toContain('OpenAI-compatible endpoint');
    expect(zhCNModels[key]).toContain('Token Plan API 密钥');
    expect(zhCNModels[key]).toContain('OpenAI 兼容端点');
  });
});
