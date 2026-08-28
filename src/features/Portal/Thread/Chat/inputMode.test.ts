import { describe, expect, it } from 'vitest';

import { getThreadInputMode } from './inputMode';

describe('getThreadInputMode', () => {
  it('uses the heterogeneous Agent composer for a continuable heterogeneous thread', () => {
    expect(getThreadInputMode({ isExternallyOwnedThread: false, isHeterogeneousAgent: true })).toBe(
      'heterogeneous',
    );
  });

  it('uses the default composer for an ordinary continuable thread', () => {
    expect(
      getThreadInputMode({ isExternallyOwnedThread: false, isHeterogeneousAgent: false }),
    ).toBe('default');
  });

  it('keeps tool-owned subagent records read-only regardless of Agent type', () => {
    expect(getThreadInputMode({ isExternallyOwnedThread: true, isHeterogeneousAgent: true })).toBe(
      'hidden',
    );
  });
});
