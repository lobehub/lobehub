/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TopicSelector from './TopicSelector';

const switchTopic = vi.fn();
const useFetchTopics = vi.fn();

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ disabled, onClick, title }: any) => (
    <button disabled={disabled} type="button" onClick={onClick}>
      {title}
    </button>
  ),
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  Flexbox: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    time: 'time',
    title: 'title',
  }),
}));

vi.mock('dayjs', () => {
  const dayjs = () => ({
    diff: () => 0,
    format: () => '2026-05-24',
    fromNow: () => 'now',
  });
  return { default: dayjs };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/const/layoutTokens', () => ({
  DESKTOP_HEADER_ICON_SMALL_SIZE: 24,
}));

vi.mock('@/features/NavHeader', () => ({
  default: ({ left, right }: any) => (
    <div>
      {left}
      {right}
    </div>
  ),
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: any) =>
    selector({
      activeTopicId: 'topic-1',
      switchTopic,
      topics: [{ id: 'topic-1', title: 'First topic', updatedAt: new Date() }],
      useFetchTopics,
    }),
}));

vi.mock('@/store/chat/slices/topic/selectors', () => ({
  topicSelectors: {
    getTopicsByAgentId: () => (s: any) => s.topics,
  },
}));

describe('AgentBuilder TopicSelector', () => {
  beforeEach(() => {
    switchTopic.mockReset();
    useFetchTopics.mockReset();
  });

  it('does not create a new topic when disabled', () => {
    render(<TopicSelector disabled agentId="agent-builder" />);

    fireEvent.click(screen.getByRole('button', { name: 'actions.addNewTopic' }));

    expect(switchTopic).not.toHaveBeenCalled();
  });
});
