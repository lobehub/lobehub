/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TaskItem from './TaskItem';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  params: {} as { aid?: string },
}));

vi.mock('@lobehub/ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({
    active,
    onClick,
    slots,
    title,
  }: {
    active?: boolean;
    onClick?: () => void;
    slots?: { titlePrefix?: ReactNode };
    title: ReactNode;
  }) => (
    <button data-active={active ? 'true' : 'false'} onClick={onClick}>
      {slots?.titlePrefix}
      {title}
    </button>
  ),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params,
}));

const task = {
  id: 'task_1',
  identifier: 'T-22',
  name: 'Hourly trend update',
};

describe('Task sidebar item', () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.params = {};
  });

  afterEach(() => {
    cleanup();
  });

  it('opens task detail inside the current agent route when an agent route param exists', () => {
    mocks.params = { aid: 'agt_current' };

    render(<TaskItem task={task as any} />);

    fireEvent.click(screen.getByRole('button', { name: 'T-22 Hourly trend update' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_current/task/T-22');
  });

  it('falls back to the global task detail route outside agent context', () => {
    render(<TaskItem task={task as any} />);

    fireEvent.click(screen.getByRole('button', { name: 'T-22 Hourly trend update' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/task/T-22');
  });
});
