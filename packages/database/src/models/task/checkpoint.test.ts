import { describe, expect, it } from 'vitest';

import {
  checkpointTaskMatcher,
  checkpointTaskPairsMatch,
  remapCheckpointConfig,
} from './checkpoint';

const a = { id: 'task_a', identifier: 'T-1' };
const b = { id: 'task_b', identifier: 'T-2' };
const target = { id: 'task_new', identifier: 'T-10' };

describe('checkpoint identity consistency', () => {
  it('compares exact identifier sets, regardless of order or duplicates', () => {
    expect(checkpointTaskPairsMatch(['T-2', 'T-1', 'T-1'], [a, b])).toBe(true);
    expect(checkpointTaskPairsMatch(['t-1'], [a])).toBe(false);
    expect(checkpointTaskPairsMatch(['T-1'], undefined)).toBe(false);
    expect(checkpointTaskPairsMatch([], [])).toBe(true);
  });
  it('matches a renamed child by id and rejects a replacement holding its old label', () => {
    const match = checkpointTaskMatcher(['T-1'], [a]);
    expect(match({ ...a, identifier: 'REN-1' })).toBe(true);
    expect(match({ ...b, identifier: 'T-1' })).toBe(false);
  });
  it('falls back to exact legacy labels when old writers leave stale pairs', () => {
    const match = checkpointTaskMatcher(['T-2'], [a]);
    expect(match(a)).toBe(false);
    expect(match(b)).toBe(true);
    expect(checkpointTaskMatcher([], [a])(a)).toBe(false);
    expect(checkpointTaskMatcher(['t-1'], undefined)(a)).toBe(false);
    expect(checkpointTaskMatcher(['task_a'], undefined)(a)).toBe(false);
    expect(checkpointTaskMatcher(['T-1'], undefined)(a)).toBe(true);
  });
});

describe('checkpoint relocation', () => {
  it('rewrites both fields and fills pairs for legacy data without activating invalid history', () => {
    expect(
      remapCheckpointConfig(
        {
          model: 'm',
          checkpoint: {
            topic: { after: true },
            tasks: { beforeIds: ['T-1', 't-1', 'OUTSIDE-2', 'task_a'] },
          },
        },
        [{ source: a, target }],
      ),
    ).toEqual({
      model: 'm',
      checkpoint: {
        topic: { after: true },
        tasks: {
          beforeIds: ['T-10', 't-1', 'OUTSIDE-2', 'task_a'],
          beforeTasks: [target],
        },
      },
    });
  });
  it('uses consistent ids after rename even if the old label now belongs to a different task', () => {
    expect(
      remapCheckpointConfig(
        {
          checkpoint: {
            tasks: {
              beforeIds: ['T-1'],
              beforeTasks: [a],
            },
          },
        },
        [
          { source: { ...a, identifier: 'REN-1' }, target },
          { source: { ...b, identifier: 'T-1' }, target: { id: 'task_wrong', identifier: 'T-11' } },
        ],
      ),
    ).toEqual({ checkpoint: { tasks: { beforeIds: ['T-10'], beforeTasks: [target] } } });
  });
  it('rebuilds stale pairs from the legacy intent and preserves unrelated references', () => {
    expect(
      remapCheckpointConfig(
        {
          checkpoint: {
            tasks: {
              afterIds: ['T-2'],
              afterTasks: [a],
            },
          },
        },
        [{ source: b, target }],
      ),
    ).toEqual({
      checkpoint: {
        tasks: {
          afterIds: ['T-10'],
          afterTasks: [target],
        },
      },
    });
    expect(
      remapCheckpointConfig(
        {
          checkpoint: {
            tasks: {
              beforeIds: ['T-1'],
              beforeTasks: [a],
            },
          },
        },
        [],
      ),
    ).toEqual({ checkpoint: { tasks: { beforeIds: ['T-1'], beforeTasks: [a] } } });
  });
  it('keeps absent and non-checkpoint configs intact', () => {
    expect(remapCheckpointConfig(null, [])).toBeNull();
    const config = { model: 'm' };
    expect(remapCheckpointConfig(config, [])).toBe(config);
  });
});
