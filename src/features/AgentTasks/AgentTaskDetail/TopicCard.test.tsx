/**
 * @vitest-environment happy-dom
 */
import type { TaskDetailActivity } from '@lobechat/types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import TopicCard from './TopicCard';

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...(await import('~base-ui-stubs')).baseUiStubs,
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (state: any) => unknown) =>
    selector({
      activeTaskId: 'T-1',
      addComment: vi.fn(),
      cancelTopic: vi.fn(),
      openTopicDrawer: vi.fn(),
      taskDetailMap: {},
    }),
}));

vi.mock('@/hooks/useActivityTime', () => ({
  useActivityTime: () => ({ text: '4m ago', title: '4m ago' }),
}));

// None of these render for this activity; they are stubbed only to keep the
// reply editor's upload stack and the verify feature out of the module graph.
vi.mock('./RunReplyEditor', () => ({ default: () => null }));
vi.mock('./RunVerifyDetail', () => ({ default: () => null }));
vi.mock('./RunVerifyTag', () => ({ default: () => null }));

// The follow-up's own behaviour lives in useRunFollowUp.test.ts; this file only
// covers the card's wiring to it.
vi.mock('./useRunFollowUp', () => ({
  resolveRunAgentId: () => 'agt_1',
  useRunFollowUp: () => ({ canFollowUp: true, submitting: false, submitFollowUp: vi.fn() }),
}));

vi.mock('@/features/AgentProfileCard/AgentProfilePopup', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const activity = {
  content: 'See [primes.py](https://example.com/primes.py) for the script.',
  id: 'run-1',
  operationId: 'op-1',
  status: 'success',
  time: new Date('2026-08-13T00:00:00.000Z').toISOString(),
  title: 'Run title',
  topicId: 'topic-1',
  type: 'topic',
} as unknown as TaskDetailActivity;

describe('TopicCard', () => {
  it('leaves links in the run output clickable', async () => {
    render(<TopicCard activity={activity} />);

    const link = screen.getByRole('link', { name: 'primes.py' });

    // The run body used to carry `pointer-events: none` so that clicks fell
    // through to the card behind it. user-event refuses to click through that
    // rule, which is exactly what a reader hit: a link that ignores the mouse.
    await expect(userEvent.click(link)).resolves.not.toThrow();
  });

  it('offers the follow-up affordance when the hook allows answering the run', () => {
    render(<TopicCard activity={activity} />);

    expect(screen.getByRole('button', { name: 'taskDetail.runFollowUp' })).toBeInTheDocument();
  });
});
