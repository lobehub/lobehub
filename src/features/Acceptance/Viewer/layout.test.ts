import { describe, expect, it } from 'vitest';

import { acceptanceFocusedLayout, acceptanceScrollLayout } from './layout';

describe('acceptanceFocusedLayout', () => {
  it('keeps deliberate reading space above and below focused check content', () => {
    expect(acceptanceFocusedLayout.contentPaddingBlock).toBe('32px 24px');
  });

  it('paces the detail heading and outline rows independently from the outer padding', () => {
    expect(acceptanceFocusedLayout.headerGap).toBe(8);
    expect(acceptanceFocusedLayout.outlineItemPaddingBlock).toBe(10);
    expect(acceptanceFocusedLayout.outlineItemPaddingInline).toBe(8);
  });
});

describe('acceptanceScrollLayout', () => {
  it('keeps one scroll owner for both overview and focused views', () => {
    expect(acceptanceScrollLayout.frameOverflow).toBe('auto');
    expect(acceptanceScrollLayout.paneOverflow).toBe('visible');
  });
});
