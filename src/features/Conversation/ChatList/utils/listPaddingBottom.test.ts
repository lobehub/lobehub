import { describe, expect, it } from 'vitest';

import { MESSAGE_ACTION_BAR_HEIGHT } from '@/const/messageActionPortal';

import { resolveListPaddingBottom } from './listPaddingBottom';

describe('resolveListPaddingBottom', () => {
  it('keeps the loose padding unchanged', () => {
    expect(resolveListPaddingBottom(0, false)).toBe(24);
    expect(resolveListPaddingBottom(100, false)).toBe(112);
  });

  it('adds room for the floating action toolbar in compact', () => {
    expect(resolveListPaddingBottom(0, true)).toBe(24 + MESSAGE_ACTION_BAR_HEIGHT);
    expect(resolveListPaddingBottom(100, true)).toBe(112 + MESSAGE_ACTION_BAR_HEIGHT);
  });
});
