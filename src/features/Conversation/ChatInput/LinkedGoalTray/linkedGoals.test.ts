import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { GoalListItem } from '@/services/goal';

import {
  isGoalRequestGenerating,
  linkedGoalConfirmState,
  MAX_LINKED_GOALS,
  selectLinkedGoals,
} from './linkedGoals';

const goal = (id: string) => ({ goal: { id } }) as unknown as GoalListItem;

const createGoalTurn = (goalId: string) =>
  ({
    children: [
      {
        content: '',
        id: `block-${goalId}`,
        tools: [
          {
            apiName: 'createGoal',
            arguments: '{}',
            id: `call-${goalId}`,
            identifier: 'lobe-goal',
            result: { content: 'started', id: 'tool-1', state: { goalId, success: true } },
            type: 'builtin',
          },
        ],
      },
    ],
    content: '',
    createdAt: 0,
    id: `msg-${goalId}`,
    role: 'assistantGroup',
  }) as unknown as UIChatMessage;

describe('selectLinkedGoals', () => {
  it('keeps goals that have no createGoal card in the conversation', () => {
    const result = selectLinkedGoals(
      [goal('goal-cli'), goal('goal-tool')],
      [createGoalTurn('goal-tool')],
    );

    expect(result.map((item) => item.goal.id)).toEqual(['goal-cli']);
  });

  it('keeps a goal a CLI agent created from this conversation even though its turn has a card', () => {
    const cliTurn = {
      children: [
        {
          content: '',
          id: 'block-cli',
          tools: [
            {
              apiName: 'Bash',
              arguments: JSON.stringify({ command: 'lh goal create "Fog" --conversation --json' }),
              id: 'call-cli',
              identifier: 'claude-code',
              result: { content: JSON.stringify({ goal: { id: 'goal-cli' } }), id: 'tool-cli' },
              type: 'default',
            },
          ],
        },
      ],
      content: '',
      createdAt: 0,
      id: 'msg-cli',
      role: 'assistantGroup',
    } as unknown as UIChatMessage;

    expect(selectLinkedGoals([goal('goal-cli')], [cliTurn]).map((item) => item.goal.id)).toEqual([
      'goal-cli',
    ]);
  });

  it('caps the tray at a few goals', () => {
    const goals = Array.from({ length: MAX_LINKED_GOALS + 2 }, (_, i) => goal(`goal-${i}`));

    expect(selectLinkedGoals(goals, [])).toHaveLength(MAX_LINKED_GOALS);
  });

  it('is empty before the list loads', () => {
    expect(selectLinkedGoals(undefined, [createGoalTurn('goal-tool')])).toEqual([]);
  });
});

const userMessage = (content: string) =>
  ({ content, createdAt: 0, id: `msg-${content}`, role: 'user' }) as unknown as UIChatMessage;

describe('isGoalRequestGenerating', () => {
  it('is on while a /goal request is generating', () => {
    expect(isGoalRequestGenerating([userMessage('/goal ship the report')], true)).toBe(true);
  });

  it('stays off for an ordinary generation', () => {
    // Polling on every generation hit the goal list every five seconds for
    // conversations that never asked for a goal.
    expect(isGoalRequestGenerating([userMessage('fix the build')], true)).toBe(false);
    expect(
      isGoalRequestGenerating(
        [userMessage('/goal ship the report'), createGoalTurn('goal-1'), userMessage('thanks')],
        true,
      ),
    ).toBe(false);
  });

  it('stays off once nothing is generating', () => {
    expect(isGoalRequestGenerating([userMessage('/goal ship the report')], false)).toBe(false);
  });
});

describe('linkedGoalConfirmState', () => {
  it("reports the server answer once the rows are the server's", () => {
    expect(linkedGoalConfirmState(true, undefined)).toBe('confirmed');
  });

  it('holds a neutral state while the first read is in flight', () => {
    expect(linkedGoalConfirmState(false, undefined)).toBe('checking');
  });

  it('reports a failed confirmation instead of checking forever', () => {
    // A settled goal with no run behind it stops polling, so nothing else would
    // ever replace the "checking" state once the first read failed.
    expect(linkedGoalConfirmState(false, new Error('offline'))).toBe('failed');
  });
});
