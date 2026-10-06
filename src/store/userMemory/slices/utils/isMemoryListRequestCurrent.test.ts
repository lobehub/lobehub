import { describe, expect, it } from 'vitest';

import { isMemoryListRequestCurrent } from './isMemoryListRequestCurrent';

describe('isMemoryListRequestCurrent', () => {
  it('rejects a page beyond the current page after a list reset', () => {
    expect(
      isMemoryListRequestCurrent(
        { page: 1, q: 'late night', sort: undefined },
        { page: 2, q: 'late night', sort: undefined },
      ),
    ).toBe(false);
  });

  it('accepts an earlier page when pagination advances before its response arrives', () => {
    expect(
      isMemoryListRequestCurrent(
        { page: 3, q: 'late night', sort: undefined },
        { page: 2, q: 'late night', sort: undefined },
      ),
    ).toBe(true);
  });

  it('rejects responses from an earlier search or sort', () => {
    expect(
      isMemoryListRequestCurrent(
        { page: 1, q: 'late night', sort: 'scorePriority' },
        { page: 1, q: undefined, sort: undefined },
      ),
    ).toBe(false);
  });
});
