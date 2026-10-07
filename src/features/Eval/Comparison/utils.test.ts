import { describe, expect, it } from 'vitest';

import {
  cellVerdict,
  type ComparisonCell,
  formatToolCalls,
  gridProgress,
  indexCells,
  rankTargets,
  resolveTargets,
  summarizeTargets,
  tallyDiagnoses,
} from './utils';

const cell = (overrides: Partial<ComparisonCell>): ComparisonCell => ({
  id: 'cell',
  model: 'm1',
  provider: 'p',
  status: 'completed',
  testCaseId: 'case_1',
  ...overrides,
});

describe('resolveTargets', () => {
  it('keeps configured order and appends targets only found on cells', () => {
    const targets = resolveTargets(
      [
        { model: 'b', provider: 'p' },
        { model: 'a', provider: 'p' },
      ],
      [cell({ model: 'a' }), cell({ model: 'c', provider: 'q' })],
    );
    expect(targets.map((t) => t.model)).toEqual(['b', 'a', 'c']);
  });
});

describe('indexCells', () => {
  it('looks a cell up by case and provider/model', () => {
    const index = indexCells([cell({ id: 'x', model: 'a' }), cell({ id: 'y', model: 'b' })]);
    expect(index.get('case_1')?.get('p/b')?.id).toBe('y');
  });
});

describe('summarizeTargets', () => {
  const targets = [{ model: 'm1', provider: 'p' }];

  it('prefers the roll-up the server stored when the run finished', () => {
    const stored = {
      averageScore: 0.5,
      errorCases: 0,
      model: 'm1',
      passRate: 1,
      passedCases: 2,
      provider: 'p',
      totalCases: 2,
    };
    expect(summarizeTargets(targets, [], [stored])).toEqual([stored]);
  });

  it('derives the roll-up from cells while the run is still settling', () => {
    const [summary] = summarizeTargets(targets, [
      cell({ passed: true, score: 1 }),
      cell({ passed: false, score: 0.5 }),
      cell({ status: 'error' }),
      cell({ status: 'running' }),
    ]);
    expect(summary).toMatchObject({
      averageScore: 0.75,
      errorCases: 1,
      passRate: 0.25,
      passedCases: 1,
      totalCases: 4,
    });
  });
});

describe('cellVerdict', () => {
  it('maps cell state to a verdict', () => {
    expect(cellVerdict(undefined)).toBe('pending');
    expect(cellVerdict(cell({ status: 'running' }))).toBe('pending');
    expect(cellVerdict(cell({ status: 'error' }))).toBe('error');
    expect(cellVerdict(cell({ passed: true }))).toBe('pass');
    expect(cellVerdict(cell({ passed: false }))).toBe('fail');
    expect(cellVerdict(cell({ passed: null }))).toBe('unjudged');
  });
});

describe('formatToolCalls', () => {
  it('renders a tool-call-only answer instead of an empty output', () => {
    expect(formatToolCalls([{ arguments: '{"q":"x"}', name: 'search' }])).toBe('search({"q":"x"})');
    expect(formatToolCalls([])).toBeUndefined();
  });
});

describe('tallyDiagnoses', () => {
  it('counts cases per diagnosis', () => {
    expect(tallyDiagnoses(['harness', 'model', 'model', 'inconclusive'])).toEqual({
      harness: 1,
      inconclusive: 1,
      model: 2,
      pass: 0,
    });
  });
});

describe('gridProgress', () => {
  it('counts settled cells against the full grid', () => {
    expect(
      gridProgress(
        [cell({ passed: true }), cell({ status: 'error' }), cell({ status: 'running' })],
        6,
      ),
    ).toEqual({ errored: 1, settled: 2, total: 6 });
  });
});

describe('rankTargets', () => {
  it('orders by pass rate, then score, then fewer errors', () => {
    const m = (model: string, passRate: number, averageScore: number, errorCases = 0) => ({
      averageScore,
      errorCases,
      model,
      passRate,
      passedCases: 0,
      provider: 'p',
      totalCases: 2,
    });
    expect(
      rankTargets([m('a', 0.5, 0.6), m('b', 1, 0.2), m('c', 0.5, 0.9), m('d', 0.5, 0.6, 1)]).map(
        (s) => s.model,
      ),
    ).toEqual(['b', 'c', 'a', 'd']);
  });
});
