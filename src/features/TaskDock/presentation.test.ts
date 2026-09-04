import { describe, expect, it, vi } from 'vitest';

import {
  groupDockTasks,
  hasCancellableTask,
  resolveDockOverview,
  shouldAutoDismiss,
} from './presentation';
import type { DockTask, DockTaskStatus } from './type';

const task = (status: DockTaskStatus, extra: Partial<DockTask> = {}): DockTask => ({
  groupLabel: 'Uploads',
  id: `${status}-${Math.random()}`,
  status,
  title: 'index.html',
  ...extra,
});

describe('resolveDockOverview', () => {
  it('stays running while any task is pending or running', () => {
    const overview = resolveDockOverview([task('success'), task('error'), task('pending')]);

    expect(overview.status).toBe('running');
    expect(overview.activeCount).toBe(1);
  });

  it('averages progress across active tasks only', () => {
    const overview = resolveDockOverview([
      task('running', { progress: 20 }),
      task('running', { progress: 80 }),
      task('success', { progress: 100 }),
    ]);

    expect(overview.progress).toBe(50);
  });

  it('treats a running task without progress as zero', () => {
    expect(resolveDockOverview([task('running')]).progress).toBe(0);
  });

  it('reports error over success once nothing is active', () => {
    expect(resolveDockOverview([task('success'), task('error')]).status).toBe('error');
  });

  it('settles at 100 with no active task', () => {
    const overview = resolveDockOverview([task('success')]);

    expect(overview).toEqual({ activeCount: 0, progress: 100, status: 'success' });
  });

  it('falls back to cancelled when nothing succeeded or failed', () => {
    expect(resolveDockOverview([task('cancelled')]).status).toBe('cancelled');
  });
});

describe('hasCancellableTask', () => {
  it('only counts active tasks that expose a cancel', () => {
    expect(hasCancellableTask([task('running')])).toBe(false);
    expect(hasCancellableTask([task('success', { cancel: vi.fn() })])).toBe(false);
    expect(hasCancellableTask([task('running', { cancel: vi.fn() })])).toBe(true);
  });
});

describe('groupDockTasks', () => {
  it('keeps both group order and task order', () => {
    const groups = groupDockTasks([
      task('running', { groupLabel: 'Publishing', title: 'index.html' }),
      task('running', { groupLabel: 'Uploads', title: 'hero.png' }),
      task('pending', { groupLabel: 'Publishing', title: 'about.html' }),
    ]);

    expect(groups.map((group) => group.label)).toEqual(['Publishing', 'Uploads']);
    expect(groups[0].tasks.map((t) => t.title)).toEqual(['index.html', 'about.html']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupDockTasks([])).toEqual([]);
  });
});

describe('shouldAutoDismiss', () => {
  it('clears a success with nothing to hand back', () => {
    expect(shouldAutoDismiss(task('success'))).toBe(true);
  });

  it('keeps a success that left a result', () => {
    expect(shouldAutoDismiss(task('success', { result: { label: 'lobe.link/x' } }))).toBe(false);
  });

  it('never clears a failure or an active task', () => {
    expect(shouldAutoDismiss(task('error'))).toBe(false);
    expect(shouldAutoDismiss(task('running'))).toBe(false);
  });
});
