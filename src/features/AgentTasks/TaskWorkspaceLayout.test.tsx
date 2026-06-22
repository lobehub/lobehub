/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetNavPanel } from '@/features/NavPanel';

import TaskWorkspaceLayout from './TaskWorkspaceLayout';

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

vi.mock('@/features/NavPanel', () => ({
  resetNavPanel: vi.fn(),
}));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

describe('TaskWorkspaceLayout', () => {
  beforeEach(() => {
    vi.mocked(resetNavPanel).mockClear();
  });

  it('resets the nav panel to the home sidebar fallback', () => {
    render(<TaskWorkspaceLayout />);

    expect(resetNavPanel).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('task-workspace-outlet')).toBeInTheDocument();
    expect(screen.getByTestId('task-agent-manager')).toBeInTheDocument();
  });
});
