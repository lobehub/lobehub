/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocumentCommentDeepLink } from './useDocumentCommentDeepLink';

const mocks = vi.hoisted(() => ({
  location: {
    hash: '#notes',
    pathname: '/acme/page/document-1',
    search: '?comment=reply-1&commentThread=root-1&source=inbox',
  },
  navigate: vi.fn(),
}));

vi.mock('react-router', () => ({ useLocation: () => mocks.location }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

describe('useDocumentCommentDeepLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.location.search = '?comment=reply-1&commentThread=root-1&source=inbox';
  });

  it('turns the query into a focus target and consumes only its own params', async () => {
    const { result } = renderHook(() => useDocumentCommentDeepLink('document-1'));

    await waitFor(() =>
      expect(result.current.focus).toMatchObject({
        commentId: 'reply-1',
        rootCommentId: 'root-1',
        token: 1,
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith('/acme/page/document-1?source=inbox#notes', {
      replace: true,
    });
  });

  it('focuses the root itself when only the thread is linked', async () => {
    mocks.location.search = '?commentThread=root-1';

    const { result } = renderHook(() => useDocumentCommentDeepLink('document-1'));

    await waitFor(() =>
      expect(result.current.focus).toMatchObject({ commentId: 'root-1', rootCommentId: 'root-1' }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith('/acme/page/document-1#notes', { replace: true });
  });

  it('drops the target once the list reports it missing', async () => {
    const { result } = renderHook(() => useDocumentCommentDeepLink('document-1'));
    await waitFor(() => expect(result.current.focus).toBeDefined());

    act(() => result.current.clearFocus());

    expect(result.current.focus).toBeUndefined();
    // The query was already consumed, so nothing re-arms the focus.
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it('falls back to the root when only the linked reply is gone', async () => {
    const { result } = renderHook(() => useDocumentCommentDeepLink('document-1'));
    await waitFor(() => expect(result.current.focus?.token).toBe(1));

    act(() => result.current.focusRoot());

    expect(result.current.focus).toMatchObject({
      commentId: 'root-1',
      rootCommentId: 'root-1',
      token: 2,
    });
  });

  it('does nothing without a comment thread target', () => {
    mocks.location.search = '?source=inbox';

    const { result } = renderHook(() => useDocumentCommentDeepLink('document-1'));

    expect(result.current.focus).toBeUndefined();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('does not hand a focus target to a different document', async () => {
    const { result } = renderHook(() => useDocumentCommentDeepLink('document-2'));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(result.current.focus).toMatchObject({ rootCommentId: 'root-1' });

    const other = renderHook(() => useDocumentCommentDeepLink('document-1'));
    // A fresh mount for another document parses its own location; this one still matches.
    expect(other.result.current.focus?.rootCommentId).toBe('root-1');
  });
});
