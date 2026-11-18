// @vitest-environment node
import type { TaskItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from '../../utils/uniqueViolation';
import { checkpointTaskMatcher, checkpointTaskPairsMatch } from '../task/checkpoint';
import { getVerifyConfig } from '../task/config';
import { isTaskIdentifierUniqueViolation, withStaleReposCleared } from '../task/utils';

const asTask = (config: unknown) => ({ config }) as TaskItem;

describe('task checkpoint helpers', () => {
  it('treats missing legacy ids as an empty label list', () => {
    expect(checkpointTaskPairsMatch(undefined, [{ id: 'task_a', identifier: 'T-1' }])).toBe(false);
    expect(checkpointTaskPairsMatch(undefined, [])).toBe(true);
  });

  it('matches nothing when neither ids nor pairs are stored', () => {
    const matches = checkpointTaskMatcher(undefined, undefined);

    expect(matches({ id: 'task_a', identifier: 'T-1' })).toBe(false);
  });
});

describe('task getVerifyConfig', () => {
  it('carries a legacy review that only sets maxIterations', () => {
    expect(getVerifyConfig(asTask({ review: { maxIterations: 3 } }))).toEqual({
      enabled: undefined,
      maxIterations: 3,
    });
  });

  it('ignores a legacy review without gate fields', () => {
    expect(getVerifyConfig(asTask({ review: { rubrics: [] } }))).toBeUndefined();
  });
});

describe('task withStaleReposCleared', () => {
  it('leaves the write untouched when the previous config is null', () => {
    const data = { assigneeAgentId: 'agent-b' };

    expect(withStaleReposCleared({ assigneeAgentId: 'agent-a', config: null }, data)).toBe(data);
  });
});

describe('task isTaskIdentifierUniqueViolation', () => {
  it('is the shared unique-violation check', () => {
    expect(isTaskIdentifierUniqueViolation).toBe(isUniqueViolation);
  });
});
