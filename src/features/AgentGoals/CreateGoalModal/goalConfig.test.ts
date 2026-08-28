import { describe, expect, it } from 'vitest';

import { buildGoalCreateInput, deriveInitialGoalCriterionTitle } from './goalConfig';

describe('deriveInitialGoalCriterionTitle', () => {
  it('uses the instruction when a free-form goal has no dedicated requirement', () => {
    expect(deriveInitialGoalCriterionTitle('  ship the quarterly report  ')).toBe(
      'ship the quarterly report',
    );
  });

  it('prefers a seeded requirement when one is available', () => {
    expect(
      deriveInitialGoalCriterionTitle('ship the quarterly report', '  include all source links  '),
    ).toBe('include all source links');
  });
});

describe('buildGoalCreateInput', () => {
  it('never sets a graph-wide round cap', () => {
    // The modal's only iteration field means "attempts on one Work". `maxRounds`
    // counts runs across every Work in the graph, so deriving it from that field
    // stranded the fourth task of a goal whose limit was three attempts.
    expect(buildGoalCreateInput({ instruction: 'ship it' })).not.toHaveProperty('maxRounds');
  });

  it('writes a positive cost budget', () => {
    expect(buildGoalCreateInput({ costBudget: 2.5, instruction: 'x' }).maxTotalCost).toBe(2.5);
  });

  it('maps a blank or non-positive cost budget to uncapped (null)', () => {
    // The coordinator reads `null` as "no cap"; an empty or 0 input must not
    // become a 0-dollar budget that would stop the goal before its first run.
    expect(buildGoalCreateInput({ instruction: 'x' }).maxTotalCost).toBeNull();
    expect(buildGoalCreateInput({ costBudget: 0, instruction: 'x' }).maxTotalCost).toBeNull();
    expect(buildGoalCreateInput({ costBudget: -3, instruction: 'x' }).maxTotalCost).toBeNull();
  });

  it('falls back to the instruction when no requirement was drafted', () => {
    expect(buildGoalCreateInput({ instruction: '  ship it  ' }).requirement).toBe('ship it');
    expect(
      buildGoalCreateInput({ instruction: 'ship it', requirement: '  all links resolve  ' })
        .requirement,
    ).toBe('all links resolve');
  });
});
