/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TaskParentBar from './TaskParentBar';

const mocks = vi.hoisted(() => ({
  getDetail: vi.fn(),
  navigate: vi.fn(),
  taskState: {} as any,
}));

const createState = (parent: any) => ({
  activeTaskId: 'T-child',
  taskDetailMap: {
    'T-child': {
      identifier: 'T-child',
      instruction: 'Child instruction',
      parent,
      status: 'running',
    },
  },
});

vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    icon,
    onClick,
  }: {
    children: ReactNode;
    icon?: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {icon}
      {children}
    </button>
  ),
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/services/task', () => ({
  taskService: {
    getDetail: mocks.getDetail,
  },
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: any) => selector(mocks.taskState),
}));

vi.mock('../features/TaskStatusIcon', () => ({
  default: () => <span>status</span>,
}));

vi.mock('../features/TaskSubtaskProgressTag', () => ({
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
      <button
        data-testid="parent-subtask"
        type="button"
        onClick={() => onSubtaskClick?.(subtask.identifier, subtask.assignee?.id ?? undefined)}
      >
        subtask
      </button>
    );
  },
}));

describe('TaskParentBar', () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.getDetail.mockReset();
    mocks.taskState = createState({
      agentId: 'agt_parent',
      identifier: 'T-parent',
      name: 'Parent task',
    });
    mocks.getDetail.mockResolvedValue({
      data: {
        agentId: 'agt_parent',
        identifier: 'T-parent',
        instruction: 'Parent instruction',
        status: 'running',
        subtasks: [],
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the parent task inside the parent task's owning agent route", async () => {
    render(<TaskParentBar />);

    fireEvent.click(screen.getByText('Parent task').closest('button')!);

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_parent/task/T-parent');
    await waitFor(() => expect(mocks.getDetail).toHaveBeenCalledWith('T-parent'));
  });

  it('falls back to the global route when the parent task owner is unknown', async () => {
    mocks.taskState = createState({
      identifier: 'T-parent',
      name: 'Parent task',
    });
    mocks.getDetail.mockResolvedValue({
      data: {
        agentId: null,
        identifier: 'T-parent',
        instruction: 'Parent instruction',
        status: 'running',
        subtasks: [],
      },
    });

    render(<TaskParentBar />);

    await waitFor(() => expect(mocks.getDetail).toHaveBeenCalledWith('T-parent'));
    fireEvent.click(screen.getByText('Parent task').closest('button')!);

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-parent');
  });

  it("opens parent subtasks inside the clicked subtask's owning agent route", async () => {
    mocks.getDetail.mockResolvedValue({
      data: {
        agentId: 'agt_parent',
        identifier: 'T-parent',
        instruction: 'Parent instruction',
        status: 'running',
        subtasks: [
          {
            assignee: { id: 'agt_sibling' },
            identifier: 'T-sibling',
            status: 'backlog',
          },
        ],
      },
    });

    render(<TaskParentBar />);

    fireEvent.click(await screen.findByTestId('parent-subtask'));

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_sibling/task/T-sibling');
  });
});
