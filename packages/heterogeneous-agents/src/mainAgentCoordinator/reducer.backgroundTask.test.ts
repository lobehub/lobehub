import { describe, expect, it } from 'vitest';

import type { HeteroBackgroundTask } from '../types';
import { createMainAgentRunState, reduceMainAgent } from './index';
import type { MainAgentReduceCtx } from './types';

const ctx: MainAgentReduceCtx = { newId: (kind) => `${kind}_1`, topicId: 'topic-1' };

const task: HeteroBackgroundTask = {
  description: 'ping',
  startedAt: 1,
  status: 'running',
  taskId: 'bys1w0wxo',
  toolName: 'Bash',
};

describe('reduceMainAgent background_task', () => {
  it('turns a snapshot into an updateBackgroundTask intent', () => {
    const state = createMainAgentRunState('msg_seed');
    const { intents, state: next } = reduceMainAgent(
      state,
      { data: { task, toolCallId: 'toolu_bash' }, type: 'background_task' },
      ctx,
    );

    expect(intents).toEqual([
      { backgroundTask: task, kind: 'updateBackgroundTask', toolCallId: 'toolu_bash' },
    ]);
    expect(next).toBe(state);
  });

  it('still reports a task after the run ended', () => {
    const ended = reduceMainAgent(
      createMainAgentRunState('msg_seed'),
      { data: {}, type: 'agent_runtime_end' },
      ctx,
    ).state;

    const { intents } = reduceMainAgent(
      ended,
      {
        data: { task: { ...task, status: 'completed' }, toolCallId: 'toolu_bash' },
        type: 'background_task',
      },
      ctx,
    );
    expect(intents).toHaveLength(1);
  });

  it('drops a malformed snapshot', () => {
    const state = createMainAgentRunState('msg_seed');
    for (const data of [{ task }, { task: { status: 'running' }, toolCallId: 't' }, {}]) {
      expect(reduceMainAgent(state, { data, type: 'background_task' }, ctx).intents).toEqual([]);
    }
  });
});
