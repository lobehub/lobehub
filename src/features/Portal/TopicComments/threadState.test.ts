import { describe, expect, it } from 'vitest';

import { resolveTopicCommentThreadState } from './threadState';

describe('resolveTopicCommentThreadState', () => {
  it('treats a garbage-collected thread root as not found', () => {
    expect(
      resolveTopicCommentThreadState({
        error: { data: { code: 'NOT_FOUND' } },
        hasData: false,
        isDeleting: false,
        isLoading: false,
      }),
    ).toBe('notFound');
  });

  it('keeps a snapshotted root ready while it revalidates in the background', () => {
    expect(
      resolveTopicCommentThreadState({
        hasData: true,
        isDeleting: false,
        isLoading: true,
      }),
    ).toBe('ready');
  });

  it.each([
    [{ error: new Error('network'), hasData: false, isDeleting: false, isLoading: false }, 'error'],
    [{ hasData: false, isDeleting: false, isLoading: true }, 'loading'],
    [{ hasData: false, isDeleting: true, isLoading: false }, 'hidden'],
    [{ hasData: false, isDeleting: false, isLoading: false }, 'notFound'],
  ] as const)('resolves %o to %s', (input, expected) => {
    expect(resolveTopicCommentThreadState(input)).toBe(expected);
  });
});
