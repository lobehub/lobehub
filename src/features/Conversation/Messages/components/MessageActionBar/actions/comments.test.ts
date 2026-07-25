/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commentsAction } from './comments';

const mocks = vi.hoisted(() => ({
  commentCount: 0,
  openTopicComments: vi.fn(),
  topicId: 'topic-1' as string | null,
  workspaceId: 'workspace-1' as string | null,
}));

vi.mock('@/features/TopicComment/hooks', () => ({
  useMessageCommentCount: () => ({
    count: mocks.commentCount,
    topicId: mocks.workspaceId ? mocks.topicId : null,
  }),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ activeTopicId: mocks.topicId, openTopicComments: mocks.openTopicComments }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const build = () =>
  renderHook(() =>
    commentsAction.useBuild({
      data: { content: 'Hello', role: 'assistant' } as UIChatMessage,
      id: 'message-1',
      role: 'assistant',
    }),
  ).result.current;

describe('commentsAction', () => {
  beforeEach(() => {
    mocks.commentCount = 0;
    mocks.openTopicComments.mockReset();
    mocks.topicId = 'topic-1';
    mocks.workspaceId = 'workspace-1';
  });

  it('opens the message-filtered comments portal', () => {
    const action = build();

    act(() => action?.handleClick?.());

    expect(mocks.openTopicComments).toHaveBeenCalledWith('topic-1', 'message-1');
  });

  it('is absent when the message already has comments', () => {
    mocks.commentCount = 1;

    expect(build()).toBeNull();
  });

  it('is absent outside a saved workspace topic', () => {
    mocks.workspaceId = null;
    expect(build()).toBeNull();

    mocks.workspaceId = 'workspace-1';
    mocks.topicId = null;
    expect(build()).toBeNull();
  });

  it.each(['tasks', 'groupTasks'])('is absent for virtual %s aggregate messages', (role) => {
    const action = renderHook(() =>
      commentsAction.useBuild({
        data: { content: '', role } as UIChatMessage,
        id: `${role}-virtual-id`,
        role: 'assistant',
      }),
    ).result.current;

    expect(action).toBeNull();
  });
});
