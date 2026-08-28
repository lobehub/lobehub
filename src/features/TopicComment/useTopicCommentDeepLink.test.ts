/**
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTopicCommentDeepLink } from './useTopicCommentDeepLink';

const mocks = vi.hoisted(() => ({
  location: {
    hash: '#section',
    pathname: '/acme/agent/agent-1/topic-1',
    search: '?comment=reply-1&commentThread=root-1&source=inbox',
  },
  navigate: vi.fn(),
  openTopicCommentThread: vi.fn(),
  openTopicComments: vi.fn(),
}));

vi.mock('react-router', () => ({ useLocation: () => mocks.location }));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));
vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: () => ({
      openTopicCommentThread: mocks.openTopicCommentThread,
      openTopicComments: mocks.openTopicComments,
    }),
  },
}));

describe('useTopicCommentDeepLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.location.search = '?comment=reply-1&commentThread=root-1&source=inbox';
  });

  it('opens the target thread, focuses the linked comment and consumes only its query params', async () => {
    renderHook(() => useTopicCommentDeepLink('topic-1'));

    await waitFor(() => expect(mocks.openTopicComments).toHaveBeenCalledWith('topic-1'));
    expect(mocks.openTopicCommentThread).toHaveBeenCalledWith(
      'topic-1',
      'root-1',
      undefined,
      undefined,
      'reply-1',
    );
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/acme/agent/agent-1/topic-1?source=inbox#section',
      { replace: true },
    );
  });

  it('does nothing without a comment thread target', () => {
    mocks.location.search = '?source=inbox';

    renderHook(() => useTopicCommentDeepLink('topic-1'));

    expect(mocks.openTopicComments).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
