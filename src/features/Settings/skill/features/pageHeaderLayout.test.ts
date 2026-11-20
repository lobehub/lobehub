import { describe, expect, it } from 'vitest';

import { getPageSearchPlacement } from './pageHeaderLayout';

describe('getPageSearchPlacement', () => {
  it('keeps the search in the title-row toolbar on desktop (Codex layout)', () => {
    expect(getPageSearchPlacement()).toBe('toolbar');
    expect(getPageSearchPlacement(false)).toBe('toolbar');
  });

  // Regression: on a phone the toolbar pushed the installed-skills page to
  // 418px, centering the title and group headings at -2px / -14px.
  it('gives the search its own row under the title on mobile', () => {
    expect(getPageSearchPlacement(true)).toBe('below-title');
  });
});
