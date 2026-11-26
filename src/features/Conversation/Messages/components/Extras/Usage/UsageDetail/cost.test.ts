import { describe, expect, it, vi } from 'vitest';

import { canShowUsageCost } from './cost';

// The official provider only exists in the business build, where `lobehub` is official.
vi.mock('@lobechat/business-const', () => ({
  BRANDING_PROVIDER: 'lobehub',
  isOfficialProvider: (id: string) => id === 'lobehub',
}));

describe('canShowUsageCost', () => {
  it('hides cost for the official provider', () => {
    expect(canShowUsageCost({ provider: 'lobehub' })).toBe(false);
  });

  it('keeps cost for other providers', () => {
    expect(canShowUsageCost({ provider: 'openai' })).toBe(true);
  });

  it('hides cost for server-default runs whatever model card matched', () => {
    expect(canShowUsageCost({ provider: 'anthropic', serverDefault: true })).toBe(false);
    expect(canShowUsageCost({ provider: 'claude-code', serverDefault: true })).toBe(false);
  });
});
