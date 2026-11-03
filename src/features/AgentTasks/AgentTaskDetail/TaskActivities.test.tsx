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

  it('keeps the newest run report on the result panel first page under newer comments', () => {
    const run: TaskDetailActivity = {
      id: 'tpc-latest',
      time: new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString(),
      title: 'latest-run',
      type: 'topic',
    };
    const olderRun: TaskDetailActivity = {
      id: 'tpc-older',
      time: new Date(Date.UTC(2025, 11, 31)).toISOString(),
      title: 'older-run',
      type: 'topic',
    };
    // 30 comments, all newer than the latest run.
    setActivities('T-1', [olderRun, run, ...Array.from({ length: 30 }, (_, i) => comment(i + 1))]);

    render(<TaskActivities variant={'result'} />);

    expect(screen.getByTestId('report').textContent).toBe('latest-run');
    expect(screen.getAllByTestId('comment')).toHaveLength(ACTIVITY_PAGE_SIZE);
    // 10 older comments + the older run remain; the pinned report is not counted.
    expect(screen.getByText('taskDetail.activitiesLoadMore:11')).toBeTruthy();

    fireEvent.click(screen.getByText('taskDetail.activitiesLoadMore:11'));

    // Once older entries are loaded the report sits in timeline order: after
    // every comment (all newer), before the older run.
    const order = screen.getAllByTestId(/^(comment|report|topic)$/).map((node) => node.textContent);
    expect(order.at(-2)).toBe('latest-run');
    expect(order.at(-1)).toBe('older-run');
    expect(screen.getAllByTestId('report')).toHaveLength(1);
  });

  it('auto-loads on scroll in the detail feed but not in the result panel', () => {
    const { unmount } = render(<TaskActivities />);
    expect(screen.getByTestId('activity-sentinel')).toBeTruthy();
    unmount();

    // Sections follow the feed in the result panel; a sentinel there would keep
    // loading pages above them as the reader scrolls toward them.
    render(<TaskActivities variant={'result'} />);
    expect(screen.queryByTestId('activity-sentinel')).toBeNull();
    expect(screen.getByText('taskDetail.activitiesLoadMore:480')).toBeTruthy();
  });
});
