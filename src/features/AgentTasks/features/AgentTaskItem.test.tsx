/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentTaskItem from './AgentTaskItem';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  taskDetailMap: {} as Record<string, { subtasks?: any[] }>,
  useFetchTaskDetail: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({
    children,
    clickable,
    onClick,
  }: {
    children: ReactNode;
    clickable?: boolean;
    onClick?: () => void;
  }) =>
    clickable ? (
      <button data-testid="task-card" type="button" onClick={onClick}>
        {children}
      </button>
    ) : (
      <span>{children}</span>
    ),
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
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

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: any) =>
    selector({
      taskDetailMap: mocks.taskDetailMap,
      useFetchTaskDetail: mocks.useFetchTaskDetail,
    }),
}));

vi.mock('./AssigneeAgentSelector', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./AssigneeAvatar', () => ({
  default: () => <span>assignee</span>,
}));

vi.mock('./formatTaskItemDate', () => ({
  formatTaskItemDate: () => 'today',
}));

vi.mock('./TaskLatestActivity', () => ({
  default: () => null,
}));

vi.mock('./TaskPriorityTag', () => ({
  default: () => <span>priority</span>,
}));

vi.mock('./TaskStatusTag', () => ({
  default: () => <span>status</span>,
}));

vi.mock('./TaskSubtaskProgressTag', () => ({
  default: ({
    onSubtaskClick,
    subtasks,
  }: {
    onSubtaskClick?: (identifier: string, assigneeAgentId?: string) => void;
    subtasks?: any[];
  }) => {
    const subtask = subtasks?.[0];
    if (!subtask) return null;

    return (
      <span
        data-testid="subtask-progress"
        onClick={(event) => {
          event.stopPropagation();
          onSubtaskClick?.(subtask.identifier, subtask.assignee?.id ?? undefined);
        }}
      >
        subtask
      </span>
    );
  },
}));

vi.mock('./TaskTriggerTag', () => ({
  default: () => <span>trigger</span>,
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
    mocks.navigate.mockClear();
    mocks.taskDetailMap = {};
    mocks.useFetchTaskDetail.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('opens an assigned task inside its owning agent route', () => {
    render(<AgentTaskItem task={createTask('agt_owner')} />);

    fireEvent.click(screen.getByTestId('task-card'));

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_owner/task/T-22');
  });

  it('opens an assigned task on the global detail route in global scope', () => {
    render(<AgentTaskItem routeScope="global" task={createTask('agt_owner')} />);

    fireEvent.click(screen.getByTestId('task-card'));

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-22');
  });

  it('falls back to the global task detail route when the task has no assignee', () => {
    render(<AgentTaskItem task={createTask(null)} />);

    fireEvent.click(screen.getByTestId('task-card'));

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-22');
  });

  it("opens a subtask inside the clicked subtask's assignee route", () => {
    mocks.taskDetailMap = {
      'T-22': {
        subtasks: [
          {
            assignee: { id: 'agt_child' },
            identifier: 'T-23',
            status: 'backlog',
          },
        ],
      },
    };

    render(<AgentTaskItem task={createTask('agt_parent')} />);

    fireEvent.click(screen.getAllByTestId('subtask-progress')[0]);

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_child/task/T-23');
  });

  it('opens a clicked subtask on the global route in global scope', () => {
    mocks.taskDetailMap = {
      'T-22': {
        subtasks: [
          {
            assignee: { id: 'agt_child' },
            identifier: 'T-23',
            status: 'backlog',
          },
        ],
      },
    };

    render(<AgentTaskItem routeScope="global" task={createTask('agt_parent')} />);

    fireEvent.click(screen.getAllByTestId('subtask-progress')[0]);

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-23');
  });

  it('falls back to the global route when the clicked subtask has no assignee', () => {
    mocks.taskDetailMap = {
      'T-22': {
        subtasks: [
          {
            identifier: 'T-23',
            status: 'backlog',
          },
        ],
      },
    };

    render(<AgentTaskItem task={createTask('agt_parent')} />);

    fireEvent.click(screen.getAllByTestId('subtask-progress')[0]);

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-23');
  });
});
