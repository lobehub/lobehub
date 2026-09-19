/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import Render from './Render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ReferTopicRender', () => {
  beforeEach(() => {
    useChatStore.setState({
      switchTopic: vi.fn(),
      topics: [],
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
});
