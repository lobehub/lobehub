import { describe, expect, it } from 'vitest';

import { isDirectorySettling } from './loading';

describe('isDirectorySettling', () => {
  it('waits while any lookup is still loading', () => {
    expect(isDirectorySettling([{ isInitialLoading: false }, { isInitialLoading: true }])).toBe(
      true,
    );
  });

  it('settles once every lookup has data', () => {
    expect(isDirectorySettling([{ isInitialLoading: false }, { isInitialLoading: false }])).toBe(
      false,
    );
  });

  it('treats a failed lookup as settled so the directory still renders', () => {
    expect(
      isDirectorySettling([
        { error: new Error('boom'), isInitialLoading: true },
        { isInitialLoading: false },
      ]),
    ).toBe(false);
  });
});
