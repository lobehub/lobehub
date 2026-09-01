/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentTaskItem from './AgentTaskItem';

const mocks = vi.hoisted(() => ({
  activeWorkspaceId: 'workspace-1' as string | undefined,
  fetchTaskDetail: vi.fn(),
  navigate: vi.fn(),
  taskDetailMap: {} as Record<string, unknown>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Tooltip: ({ children, title }: { children: ReactNode; title?: ReactNode }) => (
    <span data-tooltip={String(title ?? '')}>{children}</span>
  ),
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: any) =>
    selector({
      fetchTaskDetail: mocks.fetchTaskDetail,
      taskDetailMap: mocks.taskDetailMap,
    }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceId', () => ({
  useActiveWorkspaceId: () => mocks.activeWorkspaceId,
}));

vi.mock('./AssigneeAgentSelector', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./AssigneeMemberSelector', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../shared/useAgentDisplayMeta', () => ({
  useAgentDisplayMeta: (agentId?: string | null) =>
    agentId ? { avatar: 'agent-avatar', backgroundColor: '#fff', title: 'Ryan' } : undefined,
}));

vi.mock('../shared/useUserDisplayMeta', () => ({
  useUserDisplayMeta: (userId?: string | null) =>
    userId ? { avatar: 'member-avatar', title: 'Shadow Arvin' } : undefined,
}));

vi.mock('./formatTaskItemDate', () => ({
  formatTaskItemDate: () => 'today',
}));

vi.mock('./TaskPriorityTag', () => ({
  default: () => <span>priority</span>,
}));

vi.mock('./TaskStatusTag', () => ({
  default: () => <span>status</span>,
}));

vi.mock('./TaskSubtaskProgressTag', () => ({
  default: ({
    onRequestSubtasks,
    progress,
  }: {
    onRequestSubtasks?: () => Promise<unknown[]>;
    progress?: { completed: number; total: number };
  }) =>
    progress ? (
      <button data-testid="subtask-progress" type="button" onClick={onRequestSubtasks}>
        {`${progress.completed}/${progress.total}`}
      </button>
    ) : null,
}));

vi.mock('./TaskTriggerTag', () => ({
  default: ({ heartbeatInterval }: { heartbeatInterval?: number | null }) => (
    <span data-testid="trigger">{heartbeatInterval}</span>
  ),
}));

vi.mock('./useTaskItemContextMenu', () => ({
  useTaskItemContextMenu: () => ({ items: [], onContextMenu: vi.fn() }),
}));

const createTask = (assigneeAgentId?: string | null) =>
  ({
    assigneeAgentId,
    createdAt: new Date('2026-05-18T00:00:00.000Z'),
    identifier: 'T-22',
    name: 'Hourly trend update',
    priority: 2,
    status: 'scheduled',
    updatedAt: new Date('2026-05-18T00:00:00.000Z'),
  }) as any;

describe('AgentTaskItem', () => {
  beforeEach(() => {
    mocks.activeWorkspaceId = 'workspace-1';
    mocks.fetchTaskDetail.mockReset();
    mocks.navigate.mockClear();
    mocks.taskDetailMap = {};
  });

  afterEach(() => {
    cleanup();
  });

  it('opens an assigned task inside its owning agent route', () => {
    render(<AgentTaskItem task={createTask('agt_owner')} />);

    fireEvent.click(screen.getByText('Hourly trend update'));

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_owner/task/T-22');
  });

  it('opens an assigned task on the global detail route in global scope', () => {
    render(<AgentTaskItem routeScope="global" task={createTask('agt_owner')} />);

    fireEvent.click(screen.getByText('Hourly trend update'));

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-22');
  });

  it('falls back to the global task detail route when the task has no assignee', () => {
    render(<AgentTaskItem task={createTask(null)} />);

    fireEvent.click(screen.getByText('Hourly trend update'));

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-22');
  });

  it('shows the assigned agent and member names in tooltips', () => {
    const { container } = render(
      <AgentTaskItem
        task={{ ...createTask('agt_owner'), assigneeUserId: 'user-1', automationMode: 'schedule' }}
      />,
    );

    expect(container.querySelector('[data-tooltip="Ryan"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tooltip="Shadow Arvin"]')).toBeInTheDocument();
  });

  it('keeps an existing member assignee visible in personal mode', () => {
    mocks.activeWorkspaceId = undefined;
    const { container } = render(
      <AgentTaskItem task={{ ...createTask('agt_owner'), assigneeUserId: 'user-1' }} />,
    );

    expect(container.querySelector('[data-tooltip="Shadow Arvin"]')).toBeInTheDocument();
  });

  it('uses an action label when an assignment is empty', () => {
    const { container, rerender } = render(
      <AgentTaskItem task={{ ...createTask(null), automationMode: null }} />,
    );

    expect(container.querySelectorAll('[data-tooltip="taskList.assignTo"]')).toHaveLength(2);

    rerender(
      <AgentTaskItem
        task={{ ...createTask('agt_owner'), assigneeUserId: 'user-1', automationMode: null }}
      />,
    );

    expect(container.querySelector('[data-tooltip="taskList.assignTo"]')).not.toBeInTheDocument();
  });

  it('uses list summaries without fetching task detail', () => {
    render(
      <AgentTaskItem
        task={{
          ...createTask('agt_parent'),
          automationMode: 'heartbeat',
          heartbeatInterval: 1800,
          subtaskProgress: { completed: 3, total: 8 },
        }}
      />,
    );

    expect(mocks.fetchTaskDetail).not.toHaveBeenCalled();
    expect(screen.getByTestId('subtask-progress')).toHaveTextContent('3/8');
    expect(screen.getByTestId('trigger')).toHaveTextContent('1800');
  });

  it('fetches subtask navigation only after the progress badge is clicked', async () => {
    mocks.fetchTaskDetail.mockResolvedValue({
      subtasks: [{ identifier: 'T-23', status: 'backlog' }],
    });

    render(
      <AgentTaskItem
        task={{
          ...createTask('agt_parent'),
          subtaskProgress: { completed: 0, total: 1 },
        }}
      />,
    );

    expect(mocks.fetchTaskDetail).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('subtask-progress'));

    await waitFor(() => expect(mocks.fetchTaskDetail).toHaveBeenCalledWith('T-22'));
  });

  it('revalidates subtask navigation when an earlier detail is cached', async () => {
    mocks.taskDetailMap = {
      'T-22': { subtasks: [{ identifier: 'T-stale', status: 'completed' }] },
    };
    mocks.fetchTaskDetail.mockResolvedValue({
      subtasks: [{ identifier: 'T-current', status: 'backlog' }],
    });

    render(
      <AgentTaskItem
        task={{
          ...createTask('agt_parent'),
          subtaskProgress: { completed: 0, total: 1 },
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('subtask-progress'));

    await waitFor(() => expect(mocks.fetchTaskDetail).toHaveBeenCalledWith('T-22'));
  });
});
