import type { AssistantContentBlock } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { deriveOperationGoals } from './deriveOperationGoals';

const block = (tools: AssistantContentBlock['tools']): AssistantContentBlock => ({
  content: '',
  id: 'assistant-1',
  tools,
});

describe('deriveOperationGoals', () => {
  it('derives a virtual Goal artifact from a successful createGoal result', () => {
    const goals = deriveOperationGoals([
      block([
        {
          apiName: 'createGoal',
          arguments: JSON.stringify({
            criteria: [{ title: 'Four lines' }, { title: 'No English' }],
            maxIterations: 3,
            name: 'San Francisco night fog',
          }),
          id: 'call-1',
          identifier: 'lobe-goal',
          result: {
            content: 'started',
            id: 'tool-1',
            state: {
              identifier: 'T-41',
              name: 'San Francisco night fog',
              success: true,
              taskId: 'task-41',
            },
          },
          type: 'builtin',
        },
      ]),
    ]);

    expect(goals).toEqual([
      {
        criteriaCount: 2,
        identifier: 'T-41',
        maxRounds: 3,
        name: 'San Francisco night fog',
        taskId: 'task-41',
      },
    ]);
  });

  it('ignores pending, failed, and non-Goal tool calls', () => {
    expect(
      deriveOperationGoals([
        block([
          {
            apiName: 'createGoal',
            arguments: '{}',
            id: 'pending',
            identifier: 'lobe-task',
            type: 'builtin',
          },
          {
            apiName: 'createGoal',
            arguments: '{}',
            id: 'failed',
            identifier: 'lobe-task',
            result: {
              content: 'failed',
              error: { message: 'boom' },
              id: 'tool-failed',
              state: { identifier: 'T-42', success: false, taskId: 'task-42' },
            },
            type: 'builtin',
          },
          {
            apiName: 'createTask',
            arguments: '{}',
            id: 'task',
            identifier: 'lobe-task',
            result: {
              content: 'created',
              id: 'tool-task',
              state: { identifier: 'T-43', success: true, taskId: 'task-43' },
            },
            type: 'builtin',
          },
        ]),
      ]),
    ).toEqual([]);
  });
});
