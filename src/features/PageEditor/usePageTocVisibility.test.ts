import { describe, expect, it } from 'vitest';

import { initialPageTocVisibilityState, reducePageTocVisibility } from './usePageTocVisibility';

describe('reducePageTocVisibility', () => {
  it('collapses without immediately opening the hover preview', () => {
    const collapsed = reducePageTocVisibility(initialPageTocVisibilityState, {
      type: 'collapse',
    });

    expect(collapsed).toEqual({
      collapsed: true,
      previewOpen: false,
      suppressMousePreview: true,
    });
    expect(reducePageTocVisibility(collapsed, { type: 'mouse-enter' })).toEqual(collapsed);
  });

  it('opens the preview after the pointer moves on the collapsed rail', () => {
    const collapsed = reducePageTocVisibility(initialPageTocVisibilityState, {
      type: 'collapse',
    });

    expect(reducePageTocVisibility(collapsed, { type: 'mouse-move' })).toEqual({
      collapsed: true,
      previewOpen: true,
      suppressMousePreview: false,
    });
  });

  it('restores the expanded outline and closes the transient preview', () => {
    const preview = {
      collapsed: true,
      previewOpen: true,
      suppressMousePreview: false,
    };

    expect(reducePageTocVisibility(preview, { type: 'expand' })).toEqual({
      collapsed: false,
      previewOpen: false,
      suppressMousePreview: false,
    });
  });
});
