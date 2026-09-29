import type { GoalEventType } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { nodeTwinKey, presentLifecycleEvent } from './lifecycleEvent';

const ctx = (types: Record<string, string> = {}, hasNodeTwin = false) => ({
  hasNodeTwin,
  workTypeOf: (id: string) => types[id],
});

const node = (reason: string | null, eventType: GoalEventType = 'updated') => ({
  entityType: 'node' as const,
  eventType,
  reason,
});

describe('presentLifecycleEvent', () => {
  it('hides the task registering its own task Work', () => {
    expect(
      presentLifecycleEvent(node('Attached Work version v1 as produced'), ctx({ v1: 'task' })),
    ).toEqual({ hidden: true });
  });

  it('shows a delivered Work as the object of a "produced" row', () => {
    expect(
      presentLifecycleEvent(node('Attached Work version v2 as produced'), ctx({ v2: 'document' })),
    ).toEqual({ action: 'work.produced', workVersion: { id: 'v2', relation: 'produced' } });
  });

  it('keeps an attached Work whose row is gone rather than hiding it', () => {
    expect(presentLifecycleEvent(node('Attached Work version v3 as supports'), ctx())).toEqual({
      action: 'work.supports',
      workVersion: { id: 'v3', relation: 'supports' },
    });
  });

  it('drops reasons that only restate the verb', () => {
    expect(presentLifecycleEvent(node('Responsible task completed', 'resolved'), ctx())).toEqual(
      {},
    );
  });

  it('reads a canceled task as such and keeps only the main Agent diagnosis', () => {
    expect(
      presentLifecycleEvent(node('Task canceled — main Agent: stuck on a duplicate node'), ctx()),
    ).toEqual({
      action: 'taskCanceled',
      note: { key: 'mainAgent', text: 'stuck on a duplicate node' },
    });
    expect(presentLifecycleEvent(node('Task canceled'), ctx())).toEqual({
      action: 'taskCanceled',
    });
  });

  it('hides the goal row a failure gate writes alongside its task row', () => {
    expect(
      presentLifecycleEvent(
        { entityType: 'goal', eventType: 'updated', reason: 'Task canceled' },
        ctx({}, true),
      ),
    ).toEqual({ hidden: true });
  });

  it('names pausing and resuming the goal', () => {
    expect(
      presentLifecycleEvent(
        { entityType: 'goal', eventType: 'updated', reason: 'paused by user' },
        ctx(),
      ),
    ).toEqual({ action: 'paused' });
    expect(
      presentLifecycleEvent(
        { entityType: 'goal', eventType: 'updated', reason: 'Goal or main Agent turn budget exhausted' },
        ctx(),
      ),
    ).toEqual({ action: 'paused', note: { key: 'budgetExhausted' } });
    expect(
      presentLifecycleEvent(
        { entityType: 'goal', eventType: 'activated', reason: 'resumed by user' },
        ctx(),
      ),
    ).toEqual({ action: 'resumed' });
  });

  it('translates fixed recovery reasons', () => {
    expect(
      presentLifecycleEvent(
        node('Recovered an abandoned Task operation and started the next attempt', 'activated'),
        ctx(),
      ),
    ).toEqual({ note: { key: 'recoveredAbandoned' } });
  });

  it('keeps an unrecognised reason as written', () => {
    expect(presentLifecycleEvent(node('Planner refined the description'), ctx())).toEqual({
      note: { text: 'Planner refined the description' },
    });
  });
});

describe('nodeTwinKey', () => {
  it('matches events written in the same second with the same reason', () => {
    const a = nodeTwinKey({ createdAt: new Date('2026-09-28T01:51:00.100Z'), reason: 'x' });
    const b = nodeTwinKey({ createdAt: new Date('2026-09-28T01:51:00.900Z'), reason: 'x' });
    expect(a).toBe(b);
  });
});
