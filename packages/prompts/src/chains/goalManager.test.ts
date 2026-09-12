import { describe, expect, it } from 'vitest';

import { buildGoalManagerPrompt, GOAL_MANAGER_PROMPT_VERSION } from './goalManager';

describe('buildGoalManagerPrompt', () => {
  it.each([
    '探索怎样从用户历史数据提炼领域判断力',
    'Explore personal predictions from past decisions',
  ])(
    'keeps supervision language tied to the goal rather than the English control prompt: %s',
    (requirement) => {
      const prompt = buildGoalManagerPrompt({
        feedback: 'Previous planning summary was in English.',
        goalId: 'goal-language',
        requirement,
        token: 'test-token',
      });
      expect(GOAL_MANAGER_PROMPT_VERSION).toBe('v4');
      expect(prompt).toContain(`Requirement: ${requirement}`);
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
      feedback: '[]',
      goalId: 'goal_1',
      problem: 'Task attempt budget was exhausted',
      requirement: 'Find the training scheme closest to my rejections',
      token: 't',
    });
    expect(prompt).toContain('Task attempt budget was exhausted');
    expect(prompt).toContain('this Goal stops on a person');
    expect(prompt).toContain('escalate with the specific question');
  });

  it('says nothing about a takeover on an ordinary planning turn', () => {
    const prompt = buildGoalManagerPrompt({
      feedback: '[]',
      goalId: 'goal_1',
      requirement: 'Find the training scheme closest to my rejections',
      token: 't',
    });
    expect(prompt).not.toContain('taking over a problem');
  });
});
