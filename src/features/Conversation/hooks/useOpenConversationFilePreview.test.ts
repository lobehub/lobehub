import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useOpenConversationFilePreview } from './useOpenConversationFilePreview';

const mocks = vi.hoisted(() => ({
  context: { isolatedTopic: false, topicId: 'topic-1' } as {
    isolatedTopic?: boolean;
    topicId?: string | null;
  },
  openFilePreview: vi.fn(),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: { openFilePreview: typeof mocks.openFilePreview }) => unknown) =>
    selector({ openFilePreview: mocks.openFilePreview }),
}));

vi.mock('../store', () => ({
  useConversationStore: (selector: (s: { context: typeof mocks.context }) => unknown) =>
    selector({ context: mocks.context }),
}));

describe('useOpenConversationFilePreview', () => {
  beforeEach(() => {
    mocks.openFilePreview.mockClear();
  });

  it('tags a preview opened from an isolated topic with that topic', () => {
    mocks.context = { isolatedTopic: true, topicId: 'topic-1' };
    const { result } = renderHook(() => useOpenConversationFilePreview());

    result.current({ fileId: 'file_1' });

    expect(mocks.openFilePreview).toHaveBeenCalledWith(
      { fileId: 'file_1' },
      { sourceTopicId: 'topic-1' },
    );
  });

  it('leaves previews from the main conversation untagged', () => {
    mocks.context = { isolatedTopic: false, topicId: 'topic-1' };
    const { result } = renderHook(() => useOpenConversationFilePreview());

    result.current({ fileId: 'file_1' });

    expect(mocks.openFilePreview).toHaveBeenCalledWith(
      { fileId: 'file_1' },
      { sourceTopicId: undefined },
    );
  });
});
