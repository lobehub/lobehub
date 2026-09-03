/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';

import type { OriginTopicPanelProps } from './originConversation';
import {
  OriginConversationProvider,
  originTopicPanelProps,
  useOriginConversation,
} from './originConversation';

const TopicPanel = (_props: OriginTopicPanelProps) => null;

const wrapper = ({ children }: { children?: ReactNode }) =>
  createElement(OriginConversationProvider, { TopicPanel, children });

describe('originTopicPanelProps', () => {
  const origin = {
    agent: { id: 'agent-1' },
    topic: { id: 'topic-1', title: 'Origin topic' },
  };

  it('stays closed until the origin topic is opened', () => {
    expect(
      originTopicPanelProps({
        isOpen: false,
        origin,
        subjectTitle: 'Subject',
      }),
    ).toBeNull();
  });

  it('returns the rail panel props after openTopicDrawer', () => {
    expect(
      originTopicPanelProps({
        isOpen: true,
        origin,
        subjectTitle: 'Subject',
      }),
    ).toEqual({
      agentId: 'agent-1',
      title: 'Origin topic',
      topicId: 'topic-1',
    });
  });

  it('falls back to the subject title when the topic has no title', () => {
    expect(
      originTopicPanelProps({
        isOpen: true,
        origin: { agent: { id: 'agent-1' }, topic: { id: 'topic-1', title: null } },
        subjectTitle: 'Subject',
      }),
    ).toEqual({
      agentId: 'agent-1',
      title: 'Subject',
      topicId: 'topic-1',
    });
  });

  it('does not open without an origin agent and topic', () => {
    expect(
      originTopicPanelProps({
        isOpen: true,
        origin: { agent: null, topic: { id: 'topic-1', title: 'Origin topic' } },
      }),
    ).toBeNull();
  });
});

describe('OriginConversationProvider', () => {
  it('opens the origin topic panel from the chip action instead of a disconnected rail flag', () => {
    const { result } = renderHook(() => useOriginConversation(), { wrapper });

    expect(result.current?.isOpen).toBe(false);

    act(() => {
      result.current?.openTopicDrawer('topic-1', { agentId: 'agent-1', title: 'Origin topic' });
    });

    expect(result.current?.isOpen).toBe(true);
    expect(result.current?.TopicPanel).toBe(TopicPanel);

    act(() => {
      result.current?.closeTopicDrawer();
    });

    expect(result.current?.isOpen).toBe(false);
  });

  it('stays hidden when the host never injects the conversation seam', () => {
    const { result } = renderHook(() => useOriginConversation());

    expect(result.current).toBeNull();
  });
});
