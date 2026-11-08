import type { TaskDetailActivity } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { resolveLiveRun } from './useLiveRun';

const run = (overrides: Partial<TaskDetailActivity>): TaskDetailActivity =>
  ({ id: 'tpc_1', status: 'running', type: 'topic', ...overrides }) as TaskDetailActivity;

describe('resolveLiveRun', () => {
  it('streams a running run by its agent author', () => {
    expect(
      resolveLiveRun(
        run({ author: { id: 'agt_1', type: 'agent' } as TaskDetailActivity['author'] }),
      ),
    ).toMatchObject({ agentId: 'agt_1', topicId: 'tpc_1' });
  });

  it('falls back to the run agent when a person started it', () => {
    expect(
      resolveLiveRun(
        run({
          agentId: 'agt_2',
          author: { id: 'usr_1', type: 'user' } as TaskDetailActivity['author'],
        }),
      ),
    ).toMatchObject({ agentId: 'agt_2' });
  });

  it('reads the report once the run settled', () => {
    expect(resolveLiveRun(run({ agentId: 'agt_1', status: 'completed' }))).toBeUndefined();
  });

  it('has nothing to stream without a run or an agent', () => {
    expect(resolveLiveRun(undefined)).toBeUndefined();
    expect(resolveLiveRun(run({ agentId: undefined }))).toBeUndefined();
    expect(resolveLiveRun(run({ agentId: 'agt_1', id: undefined }))).toBeUndefined();
  });
});
