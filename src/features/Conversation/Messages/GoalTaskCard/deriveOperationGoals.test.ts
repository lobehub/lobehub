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
              goalId: 'goal-41',
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
      { criteriaCount: 2, goalId: 'goal-41', name: 'San Francisco night fog' },
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
              state: { goalId: 'goal-42', success: false },
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
              state: { goalId: 'goal-43', success: true },
            },
            type: 'builtin',
          },
        ]),
      ]),
    ).toEqual([]);
  });

  it("derives a Goal from a heterogeneous agent's `lh goal create --json` shell call", () => {
    const goals = deriveOperationGoals([
      block([
        {
          apiName: 'Bash',
          arguments: JSON.stringify({
            command:
              'lh goal create "Weekly digest" --conversation -r "Summarize the week" --criterion "Covers every merged PR" --criterion "Written in Chinese" --json',
          }),
          id: 'call-1',
          identifier: 'claude-code',
          result: {
            content: JSON.stringify({
              edges: [],
              goal: { id: 'goal_abc123', status: 'running', title: 'Weekly digest' },
              nodes: [],
              turnToken: 'tt-1',
              url: 'https://app.lobehub.com/goal/goal_abc123',
            }),
            id: 'tool-1',
          },
          type: 'default',
        },
      ]),
    ]);

    expect(goals).toEqual([{ criteriaCount: 2, goalId: 'goal_abc123', name: 'Weekly digest' }]);
  });

  it('falls back to the printed goal URL when the CLI output is not JSON', () => {
    const goals = deriveOperationGoals([
      block([
        {
          apiName: 'shell',
          arguments: JSON.stringify({
            command: ['lh', 'goal', 'create', 'Weekly digest', '--conversation'],
          }),
          id: 'call-1',
          identifier: 'codex',
          result: {
            content:
              'Weekly digest goal_abc123 [running]\n\ngoal: https://app.lobehub.com/goal/goal_abc123',
            id: 'tool-1',
          },
          type: 'default',
        },
      ]),
    ]);

    expect(goals).toEqual([{ criteriaCount: 0, goalId: 'goal_abc123', name: 'goal_abc123' }]);
  });

  it('recovers the goal id from truncated output with a shell notice suffix', () => {
    // Real stored shape: a long graph snapshot is cut mid-JSON before the url
    // field, and the shell appends its own cwd notice after it.
    const goals = deriveOperationGoals([
      block([
        {
          apiName: 'Bash',
          arguments: JSON.stringify({
            command:
              'cd /tmp && lh goal create "凭证委托场景全景" --conversation --criterion "覆盖 sudo 场景" --json',
          }),
          id: 'call-1',
          identifier: 'claude-code',
          result: {
            content:
              '{\n  "decisions": [],\n  "events": [\n    {\n      "goalId": "goal_4aVZVqoD5jhu",\n      "eventType": "created",\n      "resolvedAt": null,\nShell cwd was reset to /Users/lobehub',
            id: 'tool-1',
          },
          type: 'default',
        },
      ]),
    ]);

    expect(goals).toEqual([
      { criteriaCount: 1, goalId: 'goal_4aVZVqoD5jhu', name: '凭证委托场景全景' },
    ]);
  });

  it('ignores shell calls that errored, created nothing, or are still running', () => {
    expect(
      deriveOperationGoals([
        block([
          {
            apiName: 'Bash',
            arguments: JSON.stringify({ command: 'lh goal create "x" --conversation --json' }),
            id: 'errored',
            identifier: 'kimi-code',
            result: { content: null, error: { message: 'exit 1' }, id: 'tool-1' },
            type: 'default',
          },
          {
            apiName: 'Bash',
            arguments: JSON.stringify({ command: 'lh goal list --json' }),
            id: 'not-create',
            identifier: 'kimi-code',
            result: {
              content: JSON.stringify({ goals: [{ id: 'goal_other' }] }),
              id: 'tool-2',
            },
            type: 'default',
          },
          {
            apiName: 'Bash',
            arguments: JSON.stringify({ command: 'lh goal create "x" --conversation --json' }),
            id: 'running',
            identifier: 'claude-code',
            type: 'default',
          },
        ]),
      ]),
    ).toEqual([]);
  });
});
