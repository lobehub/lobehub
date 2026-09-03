/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import TopicPanel from './TopicPanel';

// Real base-ui ActionIcon only surfaces its title via a hover Tooltip, so the
// static DOM has no accessible name to query.
vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ActionIcon: ({ onClick, title }: { onClick?: () => void; title?: string }) =>
    createElement('button', { onClick, title }, title),
}));

vi.mock('@/features/AgentTasks/AgentTaskDetail/TopicChatDrawer', () => ({
  TopicChatDrawerBody: ({
    agentId,
    defaultInputExpanded,
    disableInputCollapse,
    topicId,
  }: {
    agentId: string;
    defaultInputExpanded?: boolean;
    disableInputCollapse?: boolean;
    topicId: string;
  }) =>
    createElement(
      'div',
      {
        'data-default-input-expanded': String(defaultInputExpanded),
        'data-disable-input-collapse': String(disableInputCollapse),
        'data-testid': 'topic-conversation',
      },
      `${agentId}:${topicId}`,
    ),
}));

describe('TopicPanel', () => {
  it('renders the topic conversation in the right rail and returns to runs', () => {
    const onBack = vi.fn();
    const onCollapse = vi.fn();
    const { getByTestId, getByText, getByTitle } = render(
      createElement(TopicPanel, {
        agentId: 'agent-1',
        onBack,
        onCollapse,
        title: 'Origin topic',
        topicId: 'topic-1',
      }),
    );

    expect(getByText('Origin topic')).toBeTruthy();
    expect(getByTestId('topic-conversation')).toHaveAttribute(
      'data-default-input-expanded',
      'true',
    );
    expect(getByTestId('topic-conversation')).toHaveAttribute(
      'data-disable-input-collapse',
      'true',
    );
    expect(getByTestId('topic-conversation').textContent).toBe('agent-1:topic-1');

    fireEvent.click(getByTitle('acceptance.origin.backToRuns'));
    expect(onBack).toHaveBeenCalledOnce();

    fireEvent.click(getByTitle('acceptance.ledger.collapse'));
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
