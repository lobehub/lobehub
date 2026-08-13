/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { branchingAction } from './branching';

const mocks = vi.hoisted(() => ({
  activeThreadId: undefined as string | undefined,
  conversationThreadId: null as string | null,
  openThreadCreator: vi.fn(),
  portalThreadId: undefined as string | undefined,
  startToForkThread: false,
  topicId: 'topic-1' as string | null,
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      activeThreadId: mocks.activeThreadId,
      openThreadCreator: mocks.openThreadCreator,
      portalThreadId: mocks.portalThreadId,
      startToForkThread: mocks.startToForkThread,
    }),
}));

vi.mock('../../../../store', () => ({
  contextSelectors: {
    threadId: (state: any) => state.context.threadId,
    topicId: (state: any) => state.context.topicId,
  },
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      context: { threadId: mocks.conversationThreadId, topicId: mocks.topicId },
    }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const build = (threadId?: string) =>
  renderHook(() =>
    branchingAction.useBuild({
      data: { content: 'Hello', role: 'assistant', threadId } as UIChatMessage,
      id: 'message-1',
      role: 'assistant',
    }),
  ).result.current;

describe('branchingAction', () => {
  beforeEach(() => {
    mocks.activeThreadId = undefined;
    mocks.conversationThreadId = null;
    mocks.openThreadCreator.mockReset();
    mocks.portalThreadId = undefined;
    mocks.startToForkThread = false;
    mocks.topicId = 'topic-1';
  });

  it('is available in the main topic', () => {
    expect(build()).toMatchObject({ key: 'branching' });
  });

  it('is absent while the mounted conversation is thread-scoped or creating a thread', () => {
    mocks.conversationThreadId = 'thread-active';
    expect(build()).toBeNull();

    mocks.conversationThreadId = null;
    mocks.startToForkThread = true;
    expect(build()).toBeNull();
  });

  it('is absent for persisted thread messages even if shell thread state is clear', () => {
    expect(build('thread-on-message')).toBeNull();
  });

  it('ignores unrelated shell thread state when the mounted conversation is the main topic', () => {
    mocks.activeThreadId = 'thread-in-another-shell';
    mocks.portalThreadId = 'thread-in-portal';
    expect(build()).toMatchObject({ key: 'branching' });
  });
});
