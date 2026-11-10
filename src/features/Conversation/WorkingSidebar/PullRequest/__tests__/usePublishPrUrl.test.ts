import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePublishPrUrl } from '../usePublishPrUrl';

const setPullRequestUrl = vi.hoisted(() => vi.fn());

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: unknown) => unknown) =>
    selector({ setWorkingSidebarPullRequestUrl: setPullRequestUrl }),
}));

describe('usePublishPrUrl', () => {
  // Work cards open the PR tab only while it can show; otherwise they keep GitHub.
  it('follows the URL and clears it on unmount', () => {
    const { rerender, unmount } = renderHook((url?: string) => usePublishPrUrl(url), {
      initialProps: 'https://github.com/o/r/pull/1',
    });
    expect(setPullRequestUrl).toHaveBeenLastCalledWith('https://github.com/o/r/pull/1');

    rerender(undefined);
    expect(setPullRequestUrl).toHaveBeenLastCalledWith(undefined);

    rerender('https://github.com/o/r/pull/1');
    unmount();
    expect(setPullRequestUrl).toHaveBeenLastCalledWith(undefined);
  });
});
