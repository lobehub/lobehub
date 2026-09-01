/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TaskSubtaskProgressTag from './TaskSubtaskProgressTag';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
}));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  DropdownMenu: ({
    children,
    items,
    open,
  }: {
    children: ReactNode;
    items?: Array<{ key: string; onClick?: () => void }>;
    open?: boolean;
  }) => (
    <div>
      {children}
      <span data-testid="dropdown-open">{String(open)}</span>
      {items?.map((item) => (
        <button
          data-testid={`subtask-${item.key}`}
          key={item.key}
          type="button"
          onClick={item.onClick}
        >
          {item.key}
        </button>
      ))}
    </div>
  ),
  toast: { error: mocks.toastError },
}));

vi.mock('./TaskStatusIcon', () => ({
  default: () => <span>status</span>,
}));

describe('TaskSubtaskProgressTag', () => {
  afterEach(() => {
    cleanup();
    mocks.toastError.mockClear();
  });

  it("passes the clicked subtask's assignee to the navigation callback", () => {
    const onSubtaskClick = vi.fn();

    render(
      <TaskSubtaskProgressTag
        subtasks={[
          {
            assignee: { avatar: null, backgroundColor: null, id: 'agt_child', title: 'Child' },
            identifier: 'T-2',
            name: 'Child task',
            status: 'backlog',
          },
        ]}
        onSubtaskClick={onSubtaskClick}
      />,
    );

    fireEvent.click(screen.getByTestId('subtask-T-2'));

    expect(onSubtaskClick).toHaveBeenCalledWith('T-2', 'agt_child');
  });

  it('renders a lightweight progress summary without a subtask tree', () => {
    render(<TaskSubtaskProgressTag progress={{ completed: 2, total: 3 }} />);

    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('uses the list summary until detail is refreshed, then yields to a newer list summary', async () => {
    const onRequestSubtasks = vi
      .fn()
      .mockResolvedValue([{ identifier: 'T-current', name: 'Current child', status: 'completed' }]);

    const { rerender } = render(
      <TaskSubtaskProgressTag
        progress={{ completed: 1, total: 2 }}
        subtasks={[{ identifier: 'T-stale', name: 'Stale child', status: 'completed' }]}
        onRequestSubtasks={onRequestSubtasks}
        onSubtaskClick={vi.fn()}
      />,
    );

    expect(screen.getByText('1/2')).toBeInTheDocument();
    fireEvent.click(screen.getByText('1/2'));
    await waitFor(() => expect(screen.getByText('1/1')).toBeInTheDocument());

    rerender(
      <TaskSubtaskProgressTag
        progress={{ completed: 2, total: 3 }}
        subtasks={[{ identifier: 'T-stale', name: 'Stale child', status: 'completed' }]}
        onRequestSubtasks={onRequestSubtasks}
        onSubtaskClick={vi.fn()}
      />,
    );

    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('loads subtask navigation on demand without opening the parent task', async () => {
    const onParentClick = vi.fn();
    const onRequestSubtasks = vi
      .fn()
      .mockResolvedValue([{ identifier: 'T-2', name: 'Child task', status: 'backlog' }]);
    const onSubtaskClick = vi.fn();

    render(
      <div onClick={onParentClick}>
        <TaskSubtaskProgressTag
          progress={{ completed: 0, total: 1 }}
          onRequestSubtasks={onRequestSubtasks}
          onSubtaskClick={onSubtaskClick}
        />
      </div>,
    );

    fireEvent.click(screen.getByText('0/1'));

    expect(onParentClick).not.toHaveBeenCalled();
    await waitFor(() => expect(onRequestSubtasks).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('dropdown-open')).toHaveTextContent('true'));
  });

  it('closes an open subtask menu without refreshing it again', async () => {
    const onRequestSubtasks = vi
      .fn()
      .mockResolvedValue([{ identifier: 'T-2', name: 'Child task', status: 'backlog' }]);

    render(
      <TaskSubtaskProgressTag
        progress={{ completed: 0, total: 1 }}
        subtasks={[{ identifier: 'T-2', name: 'Child task', status: 'backlog' }]}
        onRequestSubtasks={onRequestSubtasks}
        onSubtaskClick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('0/1'));
    await waitFor(() => expect(screen.getByTestId('dropdown-open')).toHaveTextContent('true'));

    fireEvent.click(screen.getByText('0/1'));

    await waitFor(() => expect(screen.getByTestId('dropdown-open')).toHaveTextContent('false'));
    expect(onRequestSubtasks).toHaveBeenCalledTimes(1);
  });

  it('removes a stale progress badge when the refreshed task has no subtasks', async () => {
    const onRequestSubtasks = vi.fn().mockResolvedValue([]);

    const { rerender } = render(
      <TaskSubtaskProgressTag
        progress={{ completed: 0, total: 1 }}
        subtasks={[{ identifier: 'T-stale', name: 'Removed child', status: 'backlog' }]}
        onRequestSubtasks={onRequestSubtasks}
        onSubtaskClick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('0/1'));

    await waitFor(() => expect(screen.queryByText('0/1')).not.toBeInTheDocument());
    expect(onRequestSubtasks).toHaveBeenCalledTimes(1);

    rerender(
      <TaskSubtaskProgressTag
        progress={{ completed: 0, total: 1 }}
        subtasks={[{ identifier: 'T-stale', name: 'Removed child', status: 'backlog' }]}
        onRequestSubtasks={onRequestSubtasks}
        onSubtaskClick={vi.fn()}
      />,
    );

    expect(screen.getByText('0/1')).toBeInTheDocument();
  });

  it('surfaces lazy-load failures and keeps the progress badge retryable', async () => {
    const onRequestSubtasks = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce([]);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <TaskSubtaskProgressTag
        progress={{ completed: 0, total: 1 }}
        onRequestSubtasks={onRequestSubtasks}
        onSubtaskClick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('0/1'));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1));
    expect(mocks.toastError).toHaveBeenCalledWith('taskList.subtaskProgress.loadFailed');

    fireEvent.click(screen.getByText('0/1'));
    await waitFor(() => expect(onRequestSubtasks).toHaveBeenCalledTimes(2));

    consoleError.mockRestore();
  });
});
