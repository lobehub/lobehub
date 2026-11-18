import { describe, expect, it } from 'vitest';

import { buildGoalMarksSection } from './goalMarks';
import { buildTaskRunPrompt } from './index';

const mark = {
  confidence: 0.75,
  confirms: 2,
  description: 'tsc fails on `internal_` actions.\nMock them in __mocks__ too.',
  id: 'm-1',
  kind: 'pattern' as const,
  refutes: 0,
  title: 'internal_ mock missing → add to __mocks__',
};

describe('buildGoalMarksSection', () => {
  it('lists each mark with its record, id and a one-line description', () => {
    const section = buildGoalMarksSection({ marks: [mark] });

    expect(section).toContain(
      '- [pattern, confirmed 2 / refuted 0] internal_ mock missing → add to __mocks__ (id: m-1)',
    );
    expect(section).toContain('  tsc fails on `internal_` actions. Mock them in __mocks__ too.');
    expect(section).toContain('`lh goal mark confirm <id>`');
  });

  it('still teaches an empty Goal how to leave the first mark', () => {
    const section = buildGoalMarksSection({ marks: [] });

    expect(section).toContain('No marks yet.');
    expect(section).toContain('lh goal mark add pattern');
  });

  it('points at the full list when the cap left marks out', () => {
    expect(buildGoalMarksSection({ marks: [mark], omitted: 3 })).toContain(
      '3 more: `lh goal mark list`.',
    );
  });

  it('labels a mark nobody has judged as unconfirmed', () => {
    expect(
      buildGoalMarksSection({ marks: [{ ...mark, confirms: 0, description: null }] }),
    ).toContain('- [pattern, unconfirmed] internal_ mock missing → add to __mocks__ (id: m-1)\n');
  });
});

describe('buildTaskRunPrompt goal marks', () => {
  const task = { id: 'task_1', identifier: 'T-1', instruction: 'Migrate', status: 'running' };

  it('adds the section after the task only for a Goal Task run', () => {
    const prompt = buildTaskRunPrompt({ goalMarks: { marks: [mark] }, task });
    expect(prompt.indexOf('<goal_marks>')).toBeGreaterThan(prompt.indexOf('</task>'));
    expect(buildTaskRunPrompt({ task })).not.toContain('<goal_marks>');
  });
});
