/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TaskSubtaskProgressTag from './TaskSubtaskProgressTag';

vi.mock('@lobehub/ui', () => ({
  Block: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <div onClick={onClick}>{children}</div>
  ),
  DropdownMenu: ({
    children,
    items,
  }: {
    children: ReactNode;
    items?: Array<{ key: string; onClick?: () => void }>;
  }) => (
    <div>
      {children}
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
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd', () => ({
  Progress: () => <span>progress</span>,
}));

vi.mock('antd-style', () => ({
  cssVar: { colorSuccess: 'green' },
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
});
