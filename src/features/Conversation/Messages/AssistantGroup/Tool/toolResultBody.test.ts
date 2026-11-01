import { LOADING_FLAT } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { hasToolResultBody } from './toolResultBody';

describe('hasToolResultBody', () => {
  it('counts a stored body that the read path projected away', () => {
    // The regression: a settled tool whose body was replaced by a view model.
    // Reading `content` alone would call it unfinished and, while the assistant
    // message is still busy, swap its card for the loading placeholder.
    expect(hasToolResultBody({ content: '', contentLength: 36_000 })).toBe(true);
  });

  it('counts an ordinary unprojected body', () => {
    expect(hasToolResultBody({ content: 'done' })).toBe(true);
  });

  it('does not count a tool that genuinely returned nothing', () => {
    expect(hasToolResultBody({ content: '' })).toBe(false);
    expect(hasToolResultBody({ content: '', contentLength: 0 })).toBe(false);
    expect(hasToolResultBody(undefined)).toBe(false);
  });

  it('does not count the streaming placeholder', () => {
    expect(hasToolResultBody({ content: LOADING_FLAT })).toBe(false);
    expect(hasToolResultBody({ content: LOADING_FLAT, contentLength: 12 })).toBe(false);
  });
});
