import { afterEach, describe, expect, it } from 'vitest';

import { IM_LAYOUT_HINT_KEY, readImLayoutHint, writeImLayoutHint } from './layoutHint';

afterEach(() => localStorage.removeItem(IM_LAYOUT_HINT_KEY));

describe('im_layout boot hint', () => {
  it('is off until the rail layout has rendered once', () => {
    expect(readImLayoutHint()).toBe(false);
  });

  it('follows the last rendered layout', () => {
    writeImLayoutHint(true);
    expect(readImLayoutHint()).toBe(true);

    writeImLayoutHint(false);
    expect(readImLayoutHint()).toBe(false);
  });
});
