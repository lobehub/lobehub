import { describe, expect, it } from 'vitest';

import { acceptanceFocusedLayout } from './layout';

describe('acceptanceFocusedLayout', () => {
  it('fits the focused workspace to its scroll container instead of the browser viewport', () => {
    expect(acceptanceFocusedLayout.viewportHeight).toBe('100%');
  });

  it('keeps deliberate reading space above and below focused check content', () => {
    expect(acceptanceFocusedLayout.contentPaddingBlock).toBe('32px 24px');
  });

  it('paces the detail heading and outline rows independently from the outer padding', () => {
    expect(acceptanceFocusedLayout.headerGap).toBe(8);
    expect(acceptanceFocusedLayout.outlineItemPaddingBlock).toBe(10);
    expect(acceptanceFocusedLayout.outlineItemPaddingInline).toBe(8);
  });
});
