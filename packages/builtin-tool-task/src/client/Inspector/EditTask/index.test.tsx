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
  userMetaById: {} as Record<string, { avatar?: string; title?: string } | undefined>,
}));

vi.mock('@/features/AgentTasks/features/AssigneeUserAvatar', () => ({
  default: ({ userId }: { userId?: string | null }) => (
    <span data-testid="member-avatar" data-user-id={userId || ''} />
  ),
}));

vi.mock('@/features/AgentTasks/shared/useUserDisplayMeta', () => ({
  useUserDisplayMeta: (id?: string | null) => (id ? mocks.userMetaById[id] : undefined),
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
    mocks.userMetaById = {};
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

describe('EditTaskInspector — member assignee', () => {
  beforeEach(() => {
    mocks.agentMetaById = {};
    mocks.userMetaById = {};
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the member name and avatar for assigneeUserId', () => {
    mocks.userMetaById.usr_2 = { avatar: 'a.png', title: 'Alice Chen' };

    renderInspector({ assigneeUserId: 'usr_2' });

    expect(screen.getByTestId('member-avatar').dataset.userId).toBe('usr_2');
    expect(screen.getByText('Alice Chen')).toBeTruthy();
    expect(screen.queryByText('usr_2')).toBeNull();
    expect(screen.queryByTestId('assignee-avatar')).toBeNull();
  });

  it('falls back to the user id when no profile is available', () => {
    renderInspector({ assigneeUserId: 'usr_missing' });

    expect(screen.getByText('usr_missing')).toBeTruthy();
  });

  it('reads an explicit null member as unassign', () => {
    renderInspector({ assigneeUserId: null });

    expect(screen.getByText('unassign')).toBeTruthy();
    expect(screen.queryByTestId('member-avatar')).toBeNull();
  });

  it('renders both chips when an agent and a member are assigned together', () => {
    mocks.agentMetaById.agt_new = { title: 'New Agent' };
    mocks.userMetaById.usr_2 = { avatar: 'a.png', title: 'Alice Chen' };

    renderInspector({ assigneeAgentId: 'agt_new', assigneeUserId: 'usr_2' });

    expect(screen.getByText('New Agent')).toBeTruthy();
    expect(screen.getByText('Alice Chen')).toBeTruthy();
    expect(screen.queryByText('unassign')).toBeNull();
  });

  it('shows the agent chip when the member side is only being cleared', () => {
    mocks.agentMetaById.agt_new = { title: 'New Agent' };

    renderInspector({ assigneeAgentId: 'agt_new', assigneeUserId: null });

    expect(screen.getByText('New Agent')).toBeTruthy();
    expect(screen.queryByText('unassign')).toBeNull();
  });
});
