import { describe, expect, it } from 'vitest';

import jzstokenModels from './jzstoken';

describe('jzstoken models', () => {
  it('keeps the dedicated model available and leaves catalog-scoped models disabled', () => {
    expect(jzstokenModels.find((model) => model.id === 'jzs-max-3.0')).toMatchObject({
      enabled: true,
      type: 'chat',
    });

    for (const id of ['gpt-5.6-terra', 'claude-sonnet-5', 'deepseek-v4-pro', 'kimi-k2.8']) {
      expect(jzstokenModels.find((model) => model.id === id)).toMatchObject({
        enabled: false,
        type: 'chat',
      });
    }
  });
});
