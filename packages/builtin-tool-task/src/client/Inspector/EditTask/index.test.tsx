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

interface AgentDisplayMetaOptions {
  fallbackToDefault?: boolean;
}

const mocks = vi.hoisted(() => ({
  agentMetaById: {} as Record<string, AgentDisplayMeta | undefined>,
}));

vi.mock('@/features/AgentTasks/features/AssigneeAvatar', () => ({
  default: ({
    agentId,
    fallbackToDefault,
  }: {
    agentId?: string | null;
    fallbackToDefault?: boolean;
  }) => (
    <span
      data-agent-id={agentId || ''}
      data-fallback-to-default={String(fallbackToDefault)}
      data-testid="assignee-avatar"
    />
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key.split('.').at(-1) || key,
  }),
}));

vi.mock('@/features/AgentTasks/shared/useAgentDisplayMeta', () => ({
  useAgentDisplayMeta: (id: string, options?: AgentDisplayMetaOptions) =>
    mocks.agentMetaById[id] ||
    (options?.fallbackToDefault === false
      ? undefined
      : {
          avatar: 'default-avatar',
          backgroundColor: '#ffffff',
          title: 'Default Agent',
        }),
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

    expect(screen.getByTestId('assignee-avatar').dataset.agentId).toBe('agt_worker');
    expect(screen.getByTestId('assignee-avatar').dataset.fallbackToDefault).toBe('false');
    expect(screen.getByText('Worker Agent')).toBeTruthy();
    expect(screen.queryByText('agt_worker')).toBeNull();
  });

  it('falls back to the agent id when assignee metadata is unavailable', () => {
    renderInspector({ assigneeAgentId: 'agt_missing' });

    expect(screen.getByTestId('assignee-avatar').dataset.agentId).toBe('agt_missing');
    expect(screen.getByTestId('assignee-avatar').dataset.fallbackToDefault).toBe('false');
    expect(screen.getByText('agt_missing')).toBeTruthy();
    expect(screen.queryByText('Default Agent')).toBeNull();
  });

  it('renders the resolved agent name instead of the raw assignee id', () => {
    mocks.agentMetaById.agt_lobe = {
      avatar: 'lobe-avatar',
      backgroundColor: '#123456',
      title: 'Lobe AI',
    };

    renderInspector({ assigneeAgentId: 'agt_lobe' });

    expect(screen.getByTestId('assignee-avatar').dataset.agentId).toBe('agt_lobe');
    expect(screen.getByTestId('assignee-avatar').dataset.fallbackToDefault).toBe('false');
    expect(screen.getByText('Lobe AI')).toBeTruthy();
    expect(screen.queryByText('agt_lobe')).toBeNull();
  });
});
