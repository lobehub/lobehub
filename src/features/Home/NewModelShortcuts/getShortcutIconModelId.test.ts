import { describe, expect, it } from 'vitest';

import { getShortcutIconModelId } from './getShortcutIconModelId';

describe('getShortcutIconModelId', () => {
  it('uses the model id so remotely configured shortcuts keep a brand icon', () => {
    expect(getShortcutIconModelId({ model: 'glm-5.3' })).toBe('glm-5.3');
    expect(getShortcutIconModelId({ model: 'gemini-3.7-flash' })).toBe('gemini-3.7-flash');
    expect(getShortcutIconModelId({ model: 'grok-4.6' })).toBe('grok-4.6');
    expect(getShortcutIconModelId({ model: 'lobehub-kimi-k3-fast' })).toBe('lobehub-kimi-k3-fast');
  });

  it('prefers iconModel when the server sends an icon alias', () => {
    expect(
      getShortcutIconModelId({
        iconModel: 'kimi-k3',
        model: 'lobehub-kimi-k3-fast',
      }),
    ).toBe('kimi-k3');
  });
});
