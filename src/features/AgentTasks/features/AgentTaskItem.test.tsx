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
  projects: undefined as { id: string; name: string }[] | undefined,
  projectsEnabled: true,
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
  default: ({ children, disabled }: { children: ReactNode; disabled?: boolean }) => (
    <span data-disabled={String(Boolean(disabled))} data-testid="agent-selector">
      {children}
    </span>
  ),
}));

vi.mock('./AssigneeMemberSelector', () => ({
  default: ({ children, ...props }: { children: ReactNode; disabled?: boolean }) => (
    <span data-disabled={String(Boolean(props.disabled))} data-testid="member-selector">
      {children}
    </span>
  ),
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

vi.mock('@/store/project', () => ({
  projectListItemSelector: (id?: string | null) => (s: { projects?: { id: string }[] }) =>
    id ? s.projects?.find((project) => project.id === id) : undefined,
  useProjectStore: (selector: (s: unknown) => unknown) => selector({ projects: mocks.projects }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/store/user/selectors', () => ({
  labPreferSelectors: { enableProjects: () => mocks.projectsEnabled },
}));

vi.mock('@/features/Projects/ProjectAvatar', () => ({
  default: () => <i data-testid="project-avatar" />,
}));

vi.mock('./useTaskItemContextMenu', () => ({
  useTaskItemContextMenu: () => ({ items: [], onContextMenu: vi.fn() }),
}));

const createTask = (assigneeAgentId?: string | null) =>
  ({
    assigneeAgentId,
    createdAt: new Date('2026-05-18T00:00:00.000Z'),
    id: 'task_22',
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
    mocks.projects = [{ id: 'proj_a', name: 'Alpha' }];
    mocks.projectsEnabled = true;
    mocks.taskDetailMap = {};
  });

  afterEach(() => {
    cleanup();
  });

  it('opens an assigned task inside its owning agent route', () => {
    render(<AgentTaskItem task={createTask('agt_owner')} />);

    fireEvent.click(screen.getByText('Hourly trend update'));

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_owner/task/T-22/hourly-trend-update');
  });

  it('opens an assigned task on the global detail route in global scope', () => {
    render(<AgentTaskItem routeScope="global" task={createTask('agt_owner')} />);

    fireEvent.click(screen.getByText('Hourly trend update'));

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-22/hourly-trend-update');
  });

  it('falls back to the global task detail route when the task has no assignee', () => {
    render(<AgentTaskItem task={createTask(null)} />);

    fireEvent.click(screen.getByText('Hourly trend update'));

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-22/hourly-trend-update');
  });

  describe('project badge', () => {
    const withProject = (projectId?: string | null) => ({
      ...createTask('agt_owner'),
      projectId,
    });

    it.each([['default'], ['compact']] as const)(
      'shows the project icon and name on a %s row, unless the surface hides it',
      (variant) => {
        const { rerender } = render(
          <AgentTaskItem task={withProject('proj_a')} variant={variant} />,
        );
        expect(screen.getByTestId('task-project-chip')).toHaveTextContent('Alpha');
        expect(screen.getByTestId('project-avatar')).toBeInTheDocument();

        rerender(<AgentTaskItem hideProject task={withProject('proj_a')} variant={variant} />);
        expect(screen.queryByTestId('task-project-chip')).not.toBeInTheDocument();
      },
    );

    it.each([
      ['no project', null],
      ['an undefined project', undefined],
      ['a project outside the list', 'proj_gone'],
    ])('renders no badge for %s', (_, projectId) => {
      render(<AgentTaskItem task={withProject(projectId)} />);

      expect(screen.queryByTestId('task-project-chip')).not.toBeInTheDocument();
      expect(screen.queryByText('proj_gone')).not.toBeInTheDocument();
      expect(screen.getByText('Hourly trend update')).toBeInTheDocument();
    });

    it('renders no badge until the list loads, or while the Projects lab is off', () => {
      mocks.projects = undefined;
      const { rerender } = render(<AgentTaskItem task={withProject('proj_a')} />);
      expect(screen.queryByTestId('task-project-chip')).not.toBeInTheDocument();

      mocks.projects = [{ id: 'proj_a', name: 'Alpha' }];
      mocks.projectsEnabled = false;
      rerender(<AgentTaskItem task={withProject('proj_a')} variant="compact" />);
      expect(screen.queryByTestId('task-project-chip')).not.toBeInTheDocument();
    });
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

  it('locks only the agent assignee while the task is running', () => {
    const { container } = render(
      <AgentTaskItem
        task={{ ...createTask('agt_owner'), assigneeUserId: 'user-1', status: 'running' }}
      />,
    );

    // The executor cannot change mid-run, but the member who owns the outcome can.
    expect(screen.getByTestId('agent-selector')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('member-selector')).toHaveAttribute('data-disabled', 'false');
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

    await waitFor(() => expect(mocks.fetchTaskDetail).toHaveBeenCalledWith('task_22'));
  });

  it('revalidates subtask navigation when an earlier detail is cached', async () => {
    mocks.taskDetailMap = {
      task_22: { subtasks: [{ identifier: 'T-stale', status: 'completed' }] },
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

    await waitFor(() => expect(mocks.fetchTaskDetail).toHaveBeenCalledWith('task_22'));
  });
});
