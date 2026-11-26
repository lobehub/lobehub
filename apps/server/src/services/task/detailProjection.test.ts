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
