import { describe, expect, it } from 'vitest';

import { getCreatedGoal, getGoalCommand } from './goalCommand';

describe('getGoalCommand', () => {
  it('reads a conversation goal create with its title and criteria', () => {
    expect(
      getGoalCommand(
        'lh goal create "整理 LobeHub 目标页区块清单" --conversation -r "需求" --criterion "至少 4 个区块" --criterion "保存为文稿" --json',
      ),
    ).toEqual({
      conversation: true,
      criteriaCount: 2,
      kind: 'create',
      title: '整理 LobeHub 目标页区块清单',
    });
  });

  it('unescapes a double-quoted title and accepts single quotes', () => {
    expect(getGoalCommand('lh goal create "Say \\"hi\\"" --conversation')).toMatchObject({
      title: 'Say "hi"',
    });
    expect(getGoalCommand("lh goal create 'Fog report'")).toEqual({
      conversation: false,
      criteriaCount: 0,
      kind: 'create',
      title: 'Fog report',
    });
  });

  it('reads the goal id of a plan submission', () => {
    expect(
      getGoalCommand('lh goal plan goal_P0NhivSBktCf --token t --file /tmp/plan.json'),
    ).toEqual({ goalId: 'goal_P0NhivSBktCf', kind: 'plan' });
  });

  it('sees through a shell wrapper and a preceding command', () => {
    expect(
      getGoalCommand(`/bin/zsh -lc 'cd /tmp && lh goal plan goal_1 --token t --file p.json'`),
    ).toEqual({ goalId: 'goal_1', kind: 'plan' });
  });

  it('keeps an unfinished title undefined while arguments stream', () => {
    expect(getGoalCommand('lh goal create "整理 LobeHub')).toMatchObject({
      kind: 'create',
      title: undefined,
    });
  });

  it('ignores other commands', () => {
    expect(getGoalCommand('lh goal show goal_1')).toBeUndefined();
    expect(getGoalCommand('echo lh goal-create')).toBeUndefined();
    expect(getGoalCommand('')).toBeUndefined();
    expect(getGoalCommand()).toBeUndefined();
  });
});

describe('getCreatedGoal', () => {
  it('reads the goal from the --json graph snapshot', () => {
    expect(
      getCreatedGoal(
        JSON.stringify({
          edges: [],
          goal: { id: 'goal_P0NhivSBktCf', title: '整理 LobeHub 目标页区块清单' },
          turnToken: 'token',
        }),
      ),
    ).toEqual({ goalId: 'goal_P0NhivSBktCf', title: '整理 LobeHub 目标页区块清单' });
  });

  it('falls back to the printed URL or event ids when the output is not JSON', () => {
    expect(
      getCreatedGoal('goal: http://localhost:3010/goal/goal_abc123\nplanning turn: …'),
    ).toEqual({ goalId: 'goal_abc123' });
    expect(getCreatedGoal('{"events": [{"goalId": "goal_xyz", "eventType": "created"')).toEqual({
      goalId: 'goal_xyz',
    });
  });

  it('returns nothing for output without a goal', () => {
    expect(getCreatedGoal('Error: An operation-bound token is required')).toBeUndefined();
    expect(getCreatedGoal(null)).toBeUndefined();
  });
});
