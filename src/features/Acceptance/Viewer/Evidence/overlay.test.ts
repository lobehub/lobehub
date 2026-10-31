import { cssVar } from '@lobehub/ui';
import { describe, expect, it } from 'vitest';

import { overlayColor } from './overlay';

describe('overlayColor', () => {
  // Screenshots and videos draw posted comments through this one rule.
  it('greys a settled mark, keeps an open one in its colour, falls back to annotation red', () => {
    expect(overlayColor({ color: 'author-hue', resolved: true })).toBe(cssVar.colorTextQuaternary);
    expect(overlayColor({ color: 'author-hue' })).toBe('author-hue');
    expect(overlayColor({})).toBe(cssVar.colorError);
  });
});
