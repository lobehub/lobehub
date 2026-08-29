/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TaskSubtaskProgressTag from './TaskSubtaskProgressTag';

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
}));

vi.mock('./TaskStatusIcon', () => ({
  default: () => <span>status</span>,
}));

describe('TaskSubtaskProgressTag', () => {
  afterEach(() => {
    cleanup();
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

  it('loads subtask navigation on demand without opening the parent task', async () => {
    const onParentClick = vi.fn();
    const onRequestSubtasks = vi.fn().mockResolvedValue(true);
    const onSubtaskClick = vi.fn();

    const { rerender } = render(
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

    rerender(
      <div onClick={onParentClick}>
        <TaskSubtaskProgressTag
          progress={{ completed: 0, total: 1 }}
          subtasks={[{ identifier: 'T-2', name: 'Child task', status: 'backlog' }]}
          onRequestSubtasks={onRequestSubtasks}
          onSubtaskClick={onSubtaskClick}
        />
      </div>,
    );

    await waitFor(() => expect(screen.getByTestId('dropdown-open')).toHaveTextContent('true'));
  });
});
