import { describe, expect, it } from 'vitest';

import {
  attemptGradeState,
  createExperimentResultsCsv,
  defaultExperimentCaseFilter,
  experimentGradingCoverage,
  experimentGradingGaps,
  experimentResultCoverage,
  experimentResultsState,
  isUnavailableExperimentResult,
  lowestPassRateCategory,
  orderExperimentContenders,
  scopeExperimentCases,
  unverifiedCaseCount,
} from './experimentResults';

describe('experiment results', () => {
  const cases = [
    { id: 'db-a', metadata: { caseId: 'native-a' } },
    { id: 'db-b', metadata: { caseId: 'native-b' } },
    { id: 'custom' },
  ];

  it('shows all cases by default when there is no second model to disagree with', () => {
    expect(defaultExperimentCaseFilter(0)).toBe('all');
    expect(defaultExperimentCaseFilter(1)).toBe('all');
    expect(defaultExperimentCaseFilter(2)).toBe('diff');
  });

  it('keeps declared order until every contender has complete results', () => {
    const contenders = [
      { id: 'unfinished', passed: 0 },
      { id: 'complete', passed: 3 },
    ];
    expect(orderExperimentContenders(contenders, (item) => item.passed, true)).toEqual(contenders);
    expect(
      orderExperimentContenders(contenders, (item) => item.passed, false).map((item) => item.id),
    ).toEqual(['complete', 'unfinished']);
    expect(contenders[0].id).toBe('unfinished');
  });

  it('uses only the native IDs selected for the experiment for all downstream views', () => {
    expect(scopeExperimentCases(cases, ['native-b']).cases).toEqual([cases[1]]);
    expect(scopeExperimentCases(cases, ['db-b']).cases).toEqual([]);
    expect(scopeExperimentCases(cases, ['custom']).cases).toEqual([cases[2]]);
  });

  it('preserves full-set behavior and distinguishes missing selections from filter emptiness', () => {
    expect(scopeExperimentCases(cases).cases).toBe(cases);
    expect(scopeExperimentCases(cases, []).cases).toBe(cases);
    expect(scopeExperimentCases(cases, ['native-b', 'deleted', 'deleted'])).toEqual({
      cases: [cases[1]],
      missingCount: 1,
      selectedCount: 2,
    });
  });

  it('reports the 293/284 history gap without replacing the saved denominator', () => {
    const results = Array.from({ length: 284 }, (_, index) => ({ testCaseId: `${index}` }));
    expect(experimentResultCoverage(293, results)).toEqual({
      available: 284,
      expected: 293,
      missing: 9,
    });
    expect(experimentResultCoverage(293, undefined)).toBeUndefined();
  });

  it('does not count duplicate rows as recovered evidence or produce negative gaps', () => {
    expect(experimentResultCoverage(2, [{ testCaseId: 'a' }, { testCaseId: 'a' }])?.missing).toBe(
      1,
    );
    expect(experimentResultCoverage(0, [{ testCaseId: 'a' }])?.missing).toBe(0);
  });

  it('distinguishes missing terminal-run evidence from pending execution or loading', () => {
    expect(isUnavailableExperimentResult('completed', [], 'a')).toBe(true);
    expect(isUnavailableExperimentResult('aborted', [], 'a')).toBe(true);
    expect(isUnavailableExperimentResult('running', [], 'a')).toBe(false);
    expect(isUnavailableExperimentResult('completed', undefined, 'a')).toBe(false);
    expect(isUnavailableExperimentResult('completed', [{ testCaseId: 'a' }], 'a')).toBe(false);
  });

  it('does not render absent or failed resources as ready zero-score results', () => {
    expect(experimentResultsState([{ loaded: true }, { loaded: false }])).toBe('loading');
    expect(experimentResultsState([{ loaded: false, error: new Error('offline') }])).toBe('error');
    expect(experimentResultsState([{ loaded: true, error: new Error('refresh failed') }])).toBe(
      'ready',
    );
    expect(experimentResultsState([{ loaded: true }])).toBe('ready');
  });

  it('does not label a fully passing category as a weak spot', () => {
    expect(lowestPassRateCategory([{ rate: undefined }, { rate: 1 }])).toBeUndefined();
    expect(
      lowestPassRateCategory([
        { name: 'a', rate: 0.5 },
        { name: 'b', rate: 0 },
      ]),
    ).toEqual({
      name: 'b',
      rate: 0,
    });
  });

  it('keeps a completed run with an ungraded row visibly incomplete', () => {
    const results = [{ testCaseId: 'a', topicId: 'topic', status: 'running' }];
    expect(experimentResultCoverage(1, results)?.missing).toBe(0);
    expect(
      experimentGradingGaps(
        [{ id: 'c', name: 'Model', runId: 'run' }],
        [{ id: 'run', status: 'completed' }],
        { run: results },
      ),
    ).toEqual([{ id: 'c', name: 'Model', ungraded: 1, awaitingExternal: 0, judgeError: 0 }]);
    expect(
      experimentGradingGaps(
        [{ id: 'c', name: 'Model', runId: 'run' }],
        [{ id: 'run', status: 'running' }],
        { run: results },
      ),
    ).toEqual([]);
  });

  it('separates step-cap no-answer and execution errors from unfinished grading', () => {
    expect(
      attemptGradeState({ status: 'failed', error: 'Step cap reached', rubricScores: [] }),
    ).toBe('noAnswer');
    expect(attemptGradeState({ status: 'error', error: 'Provider unavailable' })).toBe('error');
    expect(attemptGradeState({ status: 'timeout' })).toBe('error');
    expect(attemptGradeState({ status: 'failed' })).toBe('ungraded');
    expect(attemptGradeState({ status: 'passed', rubricScores: [{}] })).toBe('graded');
    expect(attemptGradeState({ status: null })).toBe('ungraded');
  });

  it('offers Rerun for legacy empty replies while retaining step-limit model failures', () => {
    const noOutput = {
      error: 'No assistant output',
      passed: false,
      rubricScores: [],
      status: 'failed' as const,
    };
    const stepCap = {
      error: 'Reached the step limit (20) without a final answer',
      passed: false,
      rubricScores: [],
      status: 'failed' as const,
    };
    expect(attemptGradeState(noOutput)).toBe('error');
    expect(attemptGradeState(stepCap)).toBe('noAnswer');
    const legacySingle = {
      testCaseId: 'single',
      topicId: 'single-topic',
      status: 'failed',
      evalResult: noOutput,
    };
    const legacyMixed = {
      testCaseId: 'mixed',
      topicId: 'mixed-topic',
      status: 'passed',
      evalResult: {
        threads: [
          {
            threadId: 'passed',
            status: 'passed' as const,
            passed: true,
            rubricScores: [{ rubricId: 'judge', score: 1 }],
          },
          { threadId: 'empty', ...noOutput },
        ],
      },
    };
    const modelFailure = {
      testCaseId: 'step-cap',
      topicId: 'cap-topic',
      status: 'failed',
      evalResult: stepCap,
    };
    expect(unverifiedCaseCount([legacySingle, legacyMixed, modelFailure])).toBe(2);
    expect(experimentGradingCoverage([legacySingle, legacyMixed, modelFailure])).toMatchObject({
      error: 2,
      graded: 1,
      noAnswer: 1,
      ungraded: 0,
    });
  });

  it('counts external completed threads as graded only with an explicit pass/fail boolean', () => {
    expect(
      experimentGradingCoverage([
        {
          testCaseId: 'a',
          topicId: 'topic',
          status: 'passed',
          evalResult: {
            threads: [
              { threadId: 't1', status: 'completed', passed: true },
              { threadId: 't2', status: 'completed', passed: false },
              { threadId: 't3', status: 'completed' },
              { threadId: 't4', status: 'external' },
              { threadId: 't5', status: 'error' },
              { threadId: 't6', status: 'failed', error: 'Step cap reached' },
            ],
          },
        },
      ]),
    ).toEqual({
      graded: 2,
      ungraded: 1,
      awaitingExternal: 1,
      error: 1,
      noAnswer: 1,
      judgeError: 0,
    });
    expect(attemptGradeState({ awaitingExternalEval: true, status: 'running' })).toBe(
      'awaitingExternal',
    );
  });

  it('counts the cases a rerun would run again: no verdict on the case or on any attempt', () => {
    const graded = {
      testCaseId: 'case',
      topicId: 'topic',
      status: 'passed',
      evalResult: { rubricScores: [{ rubricId: 'judge', score: 1 }] },
    };
    expect(unverifiedCaseCount(undefined)).toBe(0);
    expect(unverifiedCaseCount([graded, { ...graded, status: 'failed' }])).toBe(0);
    expect(
      unverifiedCaseCount([
        { ...graded, status: 'error' },
        { ...graded, status: 'timeout' },
        { ...graded, status: 'judge_error' },
      ]),
    ).toBe(3);
    // k > 1: one blocked attempt inside a passed case still needs the rerun.
    expect(
      unverifiedCaseCount([
        {
          ...graded,
          evalResult: {
            threads: [
              { threadId: '1', status: 'passed' },
              { threadId: '2', status: 'error', error: 'Provider blocked the response' },
            ],
          },
        },
      ]),
    ).toBe(1);
    expect(
      unverifiedCaseCount([
        {
          ...graded,
          evalResult: {
            threads: [
              { threadId: '1', status: 'passed' },
              { threadId: '2', status: 'failed' },
            ],
          },
        },
      ]),
    ).toBe(0);
  });
  it('keeps Judge failures separate from execution errors and graded samples', () => {
    expect(attemptGradeState({ status: 'judge_error', rubricScores: [{}] })).toBe('judgeError');
    expect(attemptGradeState({ status: 'passed', errorPhase: 'judge', rubricScores: [{}] })).toBe(
      'judgeError',
    );
    const topic = {
      testCaseId: 'a',
      topicId: 'topic',
      status: 'judge_error',
      evalResult: { errorPhase: 'judge' as const, error: 'Judge unavailable', rubricScores: [] },
    };
    // A judge failure is no verdict: Rerun runs the case again.
    expect(unverifiedCaseCount([topic])).toBe(1);
    expect(
      experimentGradingGaps(
        [{ id: 'c', name: 'Model', runId: 'run' }],
        [{ id: 'run', status: 'completed' }],
        { run: [topic] },
      ),
    ).toEqual([{ id: 'c', name: 'Model', ungraded: 0, awaitingExternal: 0, judgeError: 1 }]);
  });

  it('counts incomplete Judge attempts within k and can re-grade the retained answers', () => {
    const topic = {
      testCaseId: 'a',
      topicId: 'topic',
      status: 'judge_error',
      evalResult: {
        threads: [
          {
            threadId: 'passed',
            status: 'passed' as const,
            rubricScores: [{ rubricId: 'r', score: 1 }],
          },
          {
            threadId: 'judge',
            status: 'judge_error' as const,
            judgeError: 'Judge unavailable',
          },
        ],
      },
    };
    expect(experimentGradingCoverage([topic])).toEqual({
      graded: 1,
      judgeError: 1,
      error: 0,
      noAnswer: 0,
      ungraded: 0,
      awaitingExternal: 0,
    });
    expect(unverifiedCaseCount([topic])).toBe(1);
  });

  it('escapes CSV commas, quotes, and line breaks in all fields', () => {
    const csv = createExperimentResultsCsv(
      [
        {
          id: 'a',
          category: 'Notes\rTasks',
          index: 8,
          results: ['passed'],
          title: 'Read, "notes"\nthen write',
        },
      ],
      ['Model, "one"'],
    );
    expect(csv).toBe(
      '#,Case,Category,"Model, ""one"""\n8,"Read, ""notes""\nthen write","Notes\rTasks",passed',
    );
  });

  it('exports exactly the selected native cases, in case order, without inventing missing results', () => {
    const csvCases = cases.map((item, index) => ({
      ...item,
      category: 'Tools',
      index: index + 1,
      results: [index === 1 ? 'unavailable' : 'passed'],
      title: `Case ${index + 1}`,
    }));
    expect(createExperimentResultsCsv(csvCases, ['Model'], ['native-b', 'missing'])).toBe(
      '#,Case,Category,Model\n2,Case 2,Tools,unavailable',
    );
    expect(
      createExperimentResultsCsv([...csvCases].reverse(), ['Model'], ['custom', 'native-a']),
    ).toBe('#,Case,Category,Model\n1,Case 1,Tools,passed\n3,Case 3,Tools,passed');
  });
});
