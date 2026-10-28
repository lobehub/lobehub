/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PinnedTopicContext } from '@/features/ChatInput/InputEditor/ReferTopic/pinnedTopic';
import { useChatStore } from '@/store/chat';

import { useMarkdown } from '../../../Messages/User/useMarkdown';
import Render from './Render';

vi.mock('../../../Messages/User/components/ContentPreview', () => ({
  default: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ReferTopicRender', () => {
  beforeEach(() => {
    useChatStore.setState({
      openTopicInPortal: vi.fn(),
      switchTopic: vi.fn(),
      topicDataMap: {},
    });
  });

  it('renders a persisted topic reference as an interactive tag', () => {
    render(
      <Render
        id="message-id"
        node={{ properties: { id: 'topic-id', name: 'Referenced topic' } }}
        tagName="refer_topic"
        type="refer_topic"
      >
        {null}
      </Render>,
    );

    fireEvent.click(screen.getByText('Referenced topic'));

    expect(useChatStore.getState().switchTopic).toHaveBeenCalledWith('topic-id');
  });

  // In a goal's supervision record the shared active topic is the record
  // itself: switching it replaced the record in place and stranded the panel
  // on the referenced topic until a refresh.
  it('opens the reference in the portal inside a surface pinned to its topic', () => {
    render(
      <PinnedTopicContext value="record-topic">
        <Render
          id="message-id"
          node={{ properties: { id: 'topic-id', name: 'Referenced topic' } }}
          tagName="refer_topic"
          type="refer_topic"
        >
          {null}
        </Render>
      </PinnedTopicContext>,
    );

    fireEvent.click(screen.getByText('Referenced topic'));

    expect(useChatStore.getState().switchTopic).not.toHaveBeenCalled();
    expect(useChatStore.getState().openTopicInPortal).toHaveBeenCalledWith('topic-id');
  });

  it('falls back to plain text when the topic id is missing', () => {
    render(
      <Render
        id="message-id"
        node={{ properties: { name: 'Referenced topic' } }}
        tagName="refer_topic"
        type="refer_topic"
      >
        {null}
      </Render>,
    );

    expect(screen.getByText('Referenced topic')).toBeInTheDocument();
  });

  it('renders serialized refer_topic markup through the user message pipeline', () => {
    const { result } = renderHook(() => useMarkdown('message-id'));
    const { components, remarkPlugins } = result.current;

    render(
      <ReactMarkdown components={components} remarkPlugins={remarkPlugins}>
        {'See <refer_topic name="Referenced topic" id="topic-id" /> for context'}
      </ReactMarkdown>,
    );

    fireEvent.click(screen.getByText('Referenced topic'));

    expect(useChatStore.getState().switchTopic).toHaveBeenCalledWith('topic-id');
  });
});
