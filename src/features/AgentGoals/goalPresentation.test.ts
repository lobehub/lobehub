import { describe, expect, it } from 'vitest';

import { formatSpan, formatUsd, goalStatusKey, summarizeGoalBudget } from './goalPresentation';

describe('goalStatusKey', () => {
  it('maps every lifecycle state to a list-vocabulary key', () => {
    expect(goalStatusKey('planning')).toBe('goalList.status.planning');
    expect(goalStatusKey('running')).toBe('goalList.status.running');
    expect(goalStatusKey('review')).toBe('goalList.status.review');
    expect(goalStatusKey('achieved')).toBe('goalList.status.achieved');
  });

  it('reads a failed goal as needing attention rather than as an error state', () => {
    expect(goalStatusKey('failed')).toBe('goalList.status.error');
  });
});

describe('formatSpan', () => {
  it('renders sub-hour spans as minutes and clamps to at least one minute', () => {
    expect(formatSpan(4 * 60_000)).toBe('4m');
    expect(formatSpan(10_000)).toBe('1m');
  });

  it('splits hour-plus spans into hours and minutes', () => {
    expect(formatSpan(71 * 60_000)).toBe('1h 11m');
  });
});

describe('formatUsd', () => {
  it('reads a budget as money without trailing noise', () => {
    expect(formatUsd(10)).toBe('$10');
    expect(formatUsd(6.4)).toBe('$6.4');
    expect(formatUsd(0)).toBe('$0');
  });

  it('rounds a long-tailed accumulation to cents', () => {
    expect(formatUsd(6.437_912)).toBe('$6.44');
  });
});

describe('summarizeGoalBudget', () => {
  it('pairs spend with the cost cap so the header can state one fraction', () => {
    expect(
      summarizeGoalBudget({ maxRounds: 5, maxTotalCost: 10 }, { runs: 3, totalCost: 6.4 }),
    ).toEqual({ cap: 10, kind: 'cost', spent: 6.4 });
  });

  it('switches to rounds when that is the unit the goal is actually capped in', () => {
    // "$6.4 / 5 rounds" is two units pretending to be a ratio.
    expect(
      summarizeGoalBudget({ maxRounds: 5, maxTotalCost: null }, { runs: 3, totalCost: 6.4 }),
    ).toEqual({ cap: 5, kind: 'rounds', runs: 3 });
  });

  it('states spend alone when nothing caps the goal', () => {
    expect(
      summarizeGoalBudget({ maxRounds: null, maxTotalCost: null }, { runs: 3, totalCost: 6.4 }),
    ).toEqual({ kind: 'uncapped', spent: 6.4 });
  });

  it('reads an absent spend as zero rather than blanking the metric', () => {
    expect(summarizeGoalBudget({ maxRounds: null, maxTotalCost: 10 })).toEqual({
      cap: 10,
      kind: 'cost',
      spent: 0,
    });
  });
});
