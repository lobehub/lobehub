import { describe, expect, it } from 'vitest';

import { buildGoalManagerPrompt, GOAL_MANAGER_PROMPT_VERSION } from './goalManager';

const base = {
  earlierFeedback: [],
  maxTurns: 12,
  newFeedback: [],
  previousTurn: false,
  token: 't',
  turn: 1,
};

describe('buildGoalManagerPrompt', () => {
  it.each([
    '探索怎样从用户历史数据提炼领域判断力',
    'Explore personal predictions from past decisions',
  ])(
    'keeps supervision language tied to the goal rather than the English control prompt: %s',
    (requirement) => {
      const prompt = buildGoalManagerPrompt({
        ...base,
        goalId: 'goal-language',
        requirement,
      });
      expect(GOAL_MANAGER_PROMPT_VERSION).toBe('v7');
      expect(prompt).toContain(`## Requirement\n${requirement}`);
      expect(prompt).toContain('Use the language of the Goal requirement');
      expect(prompt).toContain(
        'progress updates, summaries, plan reasons, Task titles and descriptions',
      );
      expect(prompt).toContain(
        'Keep CLI commands, JSON keys, identifiers and literal tool output unchanged',
      );
      expect(prompt).toContain(
        'even when earlier conversation turns or tool results are in English',
      );
    },
  );

  /**
   * Regression: a takeover turn has to know what it is taking over. Without the
   * problem the coordinator hands over, the main Agent reads an ordinary planning
   * turn and re-plans work that is already in flight.
   */
  it('states the handed-over problem and the answers that move the goal', () => {
    const prompt = buildGoalManagerPrompt({
      ...base,
      goalId: 'goal_1',
      problem: 'Task attempt budget was exhausted',
      requirement: 'Find the training scheme closest to my rejections',
    });
    expect(prompt).toContain('Task attempt budget was exhausted');
    expect(prompt).toContain('this Goal stops on a person');
    expect(prompt).toContain('escalate with the specific question');
  });

  /**
   * Regression: without dependsOn every planned task hung directly off the
   * problem node, so a four-round Goal rendered as one flat row.
   */
  it('asks each planned task to declare what it builds on', () => {
    const prompt = buildGoalManagerPrompt({
      ...base,
      goalId: 'goal_1',
      requirement: 'Research how agents can manage a database',
    });
    expect(prompt).toContain('"dependsOn":["task node ID from an earlier round", 0]');
    expect(prompt).toContain('Never depend on a retired or rejected node');
  });

  it('says nothing about a takeover on an ordinary planning turn', () => {
    const prompt = buildGoalManagerPrompt({
      ...base,
      goalId: 'goal_1',
      requirement: 'Find the training scheme closest to my rejections',
    });
    expect(prompt).not.toContain('Takeover');
  });

  /**
   * Regression: every turn resent the same contract and the last 20 comments as
   * one JSON blob, so the management conversation showed identical 5 KB messages
   * and a reader could not tell what a given turn was asked to act on.
   */
  it('leads with what is particular to this turn and marks only new feedback as new', () => {
    const prompt = buildGoalManagerPrompt({
      ...base,
      earlierFeedback: [
        {
          author: 'user',
          content: 'Old note that the previous turn already handled.\nSecond line.',
          taskId: 'task_old',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      goalId: 'goal_1',
      newFeedback: [
        {
          author: 'agent agt_1',
          content: 'Baseline is wrong; fix it before prediction.',
          taskId: 'task_new',
          updatedAt: '2026-10-02T00:00:00.000Z',
        },
      ],
      previousPlan: { action: 'tasks', reason: 'Collect the remaining evidence' },
      previousTurn: true,
      requirement: 'Find the training scheme closest to my rejections',
      turn: 3,
    });

    expect(prompt.split('\n')[0]).toBe('Goal manager v7 · Goal goal_1 · planning turn 3/12');
    expect(prompt).toContain(
      '## Previous turn\nsubmitted `tasks` — Collect the remaining evidence',
    );
    const fresh = prompt.slice(
      prompt.indexOf('## New review feedback'),
      prompt.indexOf('## Earlier'),
    );
    expect(fresh).toContain('task_new · agent agt_1');
    expect(fresh).toContain('> Baseline is wrong; fix it before prediction.');
    expect(fresh).not.toContain('task_old');
    expect(prompt).toContain(
      '- task_old · user: Old note that the previous turn already handled. Second line.',
    );
    // Turn-specific sections come before the contract that repeats every turn.
    expect(prompt.indexOf('## New review feedback')).toBeLessThan(
      prompt.indexOf('## Standing instructions'),
    );
  });

  it('says when the previous turn left without a plan and nothing new arrived', () => {
    const prompt = buildGoalManagerPrompt({
      ...base,
      goalId: 'goal_1',
      previousTurn: true,
      requirement: 'r',
      turn: 2,
    });
    expect(prompt).toContain('## Previous turn\nexited without submitting a plan');
    expect(prompt).toContain('## New review feedback since the previous turn\nNone.');
    expect(prompt).not.toContain('## Earlier feedback');
  });
});
