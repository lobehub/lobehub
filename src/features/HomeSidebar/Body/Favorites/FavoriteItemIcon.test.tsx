/**
 * @vitest-environment happy-dom
 */
import type { FavoriteItem } from '@lobechat/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import FavoriteItemIcon from './FavoriteItemIcon';

const state = vi.hoisted(() => ({
  activeDetail: undefined as { id: string; status: string } | undefined,
}));

vi.mock('@/store/task', () => ({
  useTaskStore: (selector: (s: unknown) => unknown) => selector({}),
}));
vi.mock('@/store/task/selectors', () => ({
  taskDetailSelectors: { activeTaskDetail: () => state.activeDetail },
}));
vi.mock('@/features/AgentTasks/features/TaskStatusIcon', () => ({
  default: ({ status }: { status: string }) => <span data-testid="status">{status}</span>,
}));
vi.mock('@/features/Home/components/RunningGlyph', () => ({
  default: () => <span data-testid="running" />,
}));
vi.mock('@/features/Favorites', () => ({
  FavoriteIcon: ({ type }: { type: string }) => <span data-testid="type">{type}</span>,
}));

const task = (status?: FavoriteItem['status']): FavoriteItem => ({
  icon: null,
  id: 'fav_1',
  path: '/task/T-1',
  status,
  targetId: 'task_1',
  title: 'Task',
  type: 'task',
});

describe('FavoriteItemIcon', () => {
  beforeEach(() => {
    state.activeDetail = undefined;
  });

  afterEach(cleanup);

  it('shows a task favorite by its listed status', () => {
    render(<FavoriteItemIcon item={task('paused')} />);

    expect(screen.getByTestId('status').textContent).toBe('paused');
  });

  it('prefers the open task detail, so a change on the page shows at once', () => {
    state.activeDetail = { id: 'task_1', status: 'completed' };
    render(<FavoriteItemIcon item={task('paused')} />);

    expect(screen.getByTestId('status').textContent).toBe('completed');
  });

  it('ignores the detail of another open task', () => {
    state.activeDetail = { id: 'task_2', status: 'completed' };
    render(<FavoriteItemIcon item={task('paused')} />);

    expect(screen.getByTestId('status').textContent).toBe('paused');
  });

  it('marks a running task with the live running glyph', () => {
    render(<FavoriteItemIcon item={task('running')} />);

    expect(screen.getByTestId('running')).toBeTruthy();
  });

  it('falls back to the type icon when the status is unknown or the item is not a task', () => {
    render(
      <>
        <FavoriteItemIcon item={task()} />
        <FavoriteItemIcon item={{ ...task('paused'), type: 'topic' }} />
      </>,
    );

    expect(screen.getAllByTestId('type').map((node) => node.textContent)).toEqual([
      'task',
      'topic',
    ]);
    expect(screen.queryByTestId('status')).toBeNull();
  });
});
