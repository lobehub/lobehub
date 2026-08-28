/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TaskWorkspaceLayout from './TaskWorkspaceLayout';

const mocks = vi.hoisted(() => ({
  isMobile: false,
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('react-router', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = (await vi.importActual('react-router')) as typeof import('react-router');

  return {
    ...actual,
    Outlet: () => <div data-testid="task-workspace-outlet">outlet</div>,
  };
});

vi.mock('@/features/AgentTaskManager', () => ({
  default: () => <div data-testid="task-agent-manager" />,
}));

vi.mock('@/features/Portal/Mobile', () => ({
  default: () => <div data-testid="mobile-task-portal" />,
}));
vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => mocks.isMobile,
}));

describe('TaskWorkspaceLayout', () => {
  beforeEach(() => {
    mocks.isMobile = false;
  });

  it('renders the task workspace without mutating global NavPanel state', () => {
    render(<TaskWorkspaceLayout />);

    expect(screen.getByTestId('task-workspace-outlet')).toBeInTheDocument();
    expect(screen.getByTestId('task-agent-manager')).toBeInTheDocument();
  });

  it('mounts the Portal surface instead of the desktop task manager on mobile', () => {
    mocks.isMobile = true;

    render(<TaskWorkspaceLayout />);

    expect(screen.getByTestId('mobile-task-portal')).toBeInTheDocument();
    expect(screen.queryByTestId('task-agent-manager')).not.toBeInTheDocument();
  });
});
