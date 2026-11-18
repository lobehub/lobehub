import { describe, expect, it } from 'vitest';

import { buildGoalObjectiveSection } from './goalObjective';
import { buildTaskRunPrompt } from './index';

const objective = {
  direction: 'max' as const,
  evaluator: './.eb/submit',
  lanes: [
    { best: 39.6021, evaluations: 4, lane: 'b', latest: 38, title: 'Lane B' },
    { best: 30, evaluations: 2, lane: 'a', latest: 30, title: 'Lane A' },
  ],
  title: 'Judge score',
  you: 'a',
};

describe('buildGoalObjectiveSection', () => {
  it('names the score, the evaluate command and where every lane stands', () => {
    const section = buildGoalObjectiveSection(objective);

    expect(section).toContain('This Goal maximises Judge score (higher is better).');
    expect(section).toContain('`lh goal evaluate`');
    expect(section).toContain('runs `./.eb/submit` there');
    expect(section).toContain('1. Lane B — best 39.6021, latest 38, 4 evaluation(s)');
    expect(section).toContain('2. Lane A (your lane) — best 30');
  });

  it('says when nothing has been evaluated, and words a minimising goal', () => {
    const section = buildGoalObjectiveSection({ ...objective, direction: 'min', lanes: [] });

    expect(section).toContain('minimises Judge score (lower is better)');
    expect(section).toContain('No evaluation recorded yet.');
  });
});

describe('buildTaskRunPrompt goal objective', () => {
  const task = { id: 'task_1', identifier: 'T-1', instruction: 'Tune', status: 'running' };

  it('puts the objective after the task and before the marks', () => {
    const prompt = buildTaskRunPrompt({ goalMarks: { marks: [] }, goalObjective: objective, task });

    expect(prompt.indexOf('<goal_objective>')).toBeGreaterThan(prompt.indexOf('</task>'));
    expect(prompt.indexOf('<goal_objective>')).toBeLessThan(prompt.indexOf('<goal_marks>'));
    expect(buildTaskRunPrompt({ task })).not.toContain('<goal_objective>');
  });
});
