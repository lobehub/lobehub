/**
 * @vitest-environment happy-dom
 */
import type { TaskDetailActivity } from '@lobechat/types';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TaskActivities from './TaskActivities';
import { ACTIVITY_PAGE_SIZE, sliceActivityPage } from './useActivityPaging';

const mocks = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  taskState: {} as any,
}));

vi.mock('@/store/task', async () => {
  const { useSyncExternalStore } = await import('react');
  const refresh = vi.fn();
  const subscribe = (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  };
  return {
    useTaskStore: (selector: any) =>
      selector({
        ...useSyncExternalStore(subscribe, () => mocks.taskState),
        internal_refreshTaskDetail: refresh,
      }),
  };
});

vi.mock('react-i18next', () => ({
  Trans: () => null,
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count === undefined ? key : `${key}:${opts.count}`,
  }),
}));

vi.mock('./CommentCard', () => ({
  default: ({ activity }: { activity: TaskDetailActivity }) => (
    <div data-testid={'comment'}>{activity.content}</div>
  ),
}));
vi.mock('./TopicCard', () => ({
  default: ({ activity }: { activity: TaskDetailActivity }) => (
    <div data-testid={'topic'}>{activity.title}</div>
  ),
}));
vi.mock('./TaskRunReport', () => ({
  default: ({ activity }: { activity: TaskDetailActivity }) => (
    <div data-testid={'report'}>{activity.title}</div>
  ),
}));
vi.mock('./CommentInput', () => ({ default: () => null }));
vi.mock('./TaskBriefCard', () => ({ default: () => null }));

const comment = (i: number): TaskDetailActivity => ({
  content: `comment-${i}`,
  id: `c-${i}`,
  time: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  type: 'comment',
});

const setActivities = (taskId: string, activities: TaskDetailActivity[]) => {
  mocks.taskState = {
    activeTaskId: taskId,
    taskDetailMap: { [taskId]: { activities, id: taskId, identifier: taskId } },
  };
  mocks.listeners.forEach((listener) => listener());
};

describe('sliceActivityPage', () => {
  it('returns everything when the list fits', () => {
    expect(sliceActivityPage([1, 2, 3], 20)).toEqual({ remaining: 0, visible: [1, 2, 3] });
  });

  it('keeps the head of the list and counts the rest', () => {
    const { remaining, visible } = sliceActivityPage(
      Array.from({ length: 50 }, (_, i) => i),
      20,
    );
    expect(visible).toHaveLength(20);
    expect(visible[0]).toBe(0);
    expect(remaining).toBe(30);
  });
});

describe('TaskActivities paging', () => {
  beforeEach(() => {
    setActivities(
      'T-1',
      Array.from({ length: 500 }, (_, i) => comment(i)),
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('mounts only the newest page of a long feed', () => {
    render(<TaskActivities />);

    const rows = screen.getAllByTestId('comment');
    expect(rows).toHaveLength(ACTIVITY_PAGE_SIZE);
    // Newest first: the latest comment leads the feed.
    expect(rows[0].textContent).toBe('comment-499');
    expect(rows.at(-1)!.textContent).toBe(`comment-${500 - ACTIVITY_PAGE_SIZE}`);
    expect(screen.getByText('taskDetail.activitiesLoadMore:480')).toBeTruthy();
  });

  it('appends the next page on demand', () => {
    render(<TaskActivities />);

    fireEvent.click(screen.getByText('taskDetail.activitiesLoadMore:480'));

    expect(screen.getAllByTestId('comment')).toHaveLength(ACTIVITY_PAGE_SIZE * 2);
    expect(screen.getByText('taskDetail.activitiesLoadMore:460')).toBeTruthy();
  });

  it('hides the load-more control when the feed fits one page', () => {
    setActivities('T-1', [comment(1), comment(2)]);
    render(<TaskActivities />);

    expect(screen.getAllByTestId('comment')).toHaveLength(2);
    expect(screen.queryByText(/taskDetail\.activitiesLoadMore/)).toBeNull();
  });

  it('starts from the first page again when another task opens', () => {
    render(<TaskActivities />);
    fireEvent.click(screen.getByText('taskDetail.activitiesLoadMore:480'));
    expect(screen.getAllByTestId('comment')).toHaveLength(ACTIVITY_PAGE_SIZE * 2);

    act(() =>
      setActivities(
        'T-2',
        Array.from({ length: 100 }, (_, i) => comment(i)),
      ),
    );

    expect(screen.getAllByTestId('comment')).toHaveLength(ACTIVITY_PAGE_SIZE);
  });

  it('pages the result panel over the cards it shows, not lifecycle rows', () => {
    const lifecycle: TaskDetailActivity[] = Array.from({ length: 30 }, (_, i) => ({
      propertyChange: { field: 'status', from: 'running', to: 'paused' },
      time: new Date(Date.UTC(2026, 0, 2, 0, 0, i)).toISOString(),
      type: 'property',
    })) as TaskDetailActivity[];
    setActivities('T-1', [...Array.from({ length: 25 }, (_, i) => comment(i)), ...lifecycle]);

    render(<TaskActivities variant={'result'} />);

    expect(screen.getAllByTestId('comment')).toHaveLength(ACTIVITY_PAGE_SIZE);
    expect(screen.getByText('taskDetail.activitiesLoadMore:5')).toBeTruthy();
  });
});
