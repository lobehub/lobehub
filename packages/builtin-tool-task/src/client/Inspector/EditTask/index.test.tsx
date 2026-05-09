/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EditTaskParams } from '../../../types';
import { EditTaskInspector } from './index';

interface AgentDisplayMeta {
  avatar?: string;
  backgroundColor?: string;
  title?: string;
}

const mocks = vi.hoisted(() => ({
  agentMetaById: {} as Record<string, AgentDisplayMeta | undefined>,
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: ({ avatar, title }: { avatar?: string; title?: string }) => (
    <span data-testid="agent-avatar" title={title}>
      {avatar}
    </span>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key.split('.').at(-1) || key,
  }),
}));

vi.mock('@/features/AgentTasks/shared/useAgentDisplayMeta', () => ({
  useAgentDisplayMeta: (id: string) => mocks.agentMetaById[id],
}));

vi.mock('@/styles', () => ({
  inspectorTextStyles: { root: 'inspector-root' },
  shinyTextStyles: { shinyText: 'shiny-text' },
}));

const renderInspector = (args: Partial<EditTaskParams>) =>
  render(
    <EditTaskInspector
      apiName="editTask"
      args={{ identifier: 'T-1', ...args }}
      identifier="lobe-task"
    />,
  );

describe('EditTaskInspector', () => {
  beforeEach(() => {
    mocks.agentMetaById = {};
  });

  afterEach(() => {
    cleanup();
  });

  it('renders assignee metadata as an avatar chip', () => {
    mocks.agentMetaById.agt_worker = {
      avatar: 'worker-avatar',
      backgroundColor: '#123456',
      title: 'Worker Agent',
    };

    renderInspector({ assigneeAgentId: 'agt_worker' });

    expect(screen.getByTestId('agent-avatar').textContent).toBe('worker-avatar');
    expect(screen.getByText('Worker Agent')).toBeTruthy();
    expect(screen.queryByText('agt_worker')).toBeNull();
  });

  it('falls back to the agent id when assignee metadata is unavailable', () => {
    renderInspector({ assigneeAgentId: 'agt_missing' });

    expect(screen.queryByTestId('agent-avatar')).toBeNull();
    expect(screen.getByText('agt_missing')).toBeTruthy();
  });

  it('renders the resolved agent name instead of the raw assignee id', () => {
    mocks.agentMetaById.agt_lobe = {
      avatar: 'lobe-avatar',
      backgroundColor: '#123456',
      title: 'Lobe AI',
    };

    renderInspector({ assigneeAgentId: 'agt_lobe' });

    expect(screen.getByTestId('agent-avatar').textContent).toBe('lobe-avatar');
    expect(screen.getByText('Lobe AI')).toBeTruthy();
    expect(screen.queryByText('agt_lobe')).toBeNull();
  });
});
