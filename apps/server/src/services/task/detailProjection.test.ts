import type { TaskItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { projectTaskDetailState } from './detailProjection';

const row = (config: Record<string, unknown>, context: unknown = {}) =>
  ({ archivedAt: null, config, context }) as unknown as TaskItem;

describe('projectTaskDetailState channelDelivery', () => {
  it('shows where results post, with the refusal of the latest post when there is one', () => {
    const config = { delivery: { channelId: 'chn_1', threadId: null } };
    expect(projectTaskDetailState(row(config), config).channelDelivery).toEqual({
      channelId: 'chn_1',
    });

    const lastError = { at: '2026-11-25T08:00:00.000Z', code: 'channel_unavailable' as const };
    expect(
      projectTaskDetailState(row(config, { delivery: { lastError } }), config).channelDelivery,
    ).toEqual({ channelId: 'chn_1', lastError });
    expect(projectTaskDetailState(row({}), {}).channelDelivery).toBeUndefined();
  });
});

describe('projectTaskDetailState fusePause', () => {
  const task = (overrides: Record<string, unknown>) =>
    ({ archivedAt: null, automationMode: 'schedule', status: 'paused', ...overrides }) as TaskItem;

  it('names the cause while the fuse holds a schedule paused', () => {
    const context = { scheduler: { consecutiveFailures: 3, pauseCause: 'insufficientBudget' } };
    expect(projectTaskDetailState(task({ context }), {}).fusePause).toEqual({
      cause: 'insufficientBudget',
      consecutiveFailures: 3,
    });
  });

  it('reads a fuse pause with no owner-side cause as plain failures', () => {
    const context = { scheduler: { consecutiveFailures: 3 } };
    expect(projectTaskDetailState(task({ context }), {}).fusePause).toEqual({
      cause: null,
      consecutiveFailures: 3,
    });
  });

  it.each([
    ['a manual pause', { context: { scheduler: { consecutiveFailures: 1 } } }],
    ['a resumed task', { context: { scheduler: { consecutiveFailures: 3 } }, status: 'scheduled' }],
    [
      'a heartbeat',
      { automationMode: 'heartbeat', context: { scheduler: { consecutiveFailures: 3 } } },
    ],
  ])('is absent for %s', (_label, overrides) => {
    expect(projectTaskDetailState(task(overrides), {}).fusePause).toBeNull();
  });
});
