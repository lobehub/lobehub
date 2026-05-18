/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentTaskItem from './AgentTaskItem';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
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

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: any) =>
    selector({
      taskDetailMap: {},
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
  default: () => null,
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

  it('falls back to the global task detail route when the task has no assignee', () => {
    render(<AgentTaskItem task={createTask(null)} />);

    fireEvent.click(screen.getByTestId('task-card'));

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-22');
  });
});
