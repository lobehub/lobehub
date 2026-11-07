import { describe, expect, it } from 'vitest';

import { summarizeCaseResult } from './caseResults';

describe('Judge error result presentation', () => {
  it('preserves diagnostics without presenting a missing score as zero or a model failure', () => {
    const result = summarizeCaseResult(
      {
        testCaseId: 'case',
        topicId: 'original-answer',
        status: 'judge_error',
        score: null,
        passed: null,
        evalResult: {
          errorPhase: 'judge',
          judgeError: 'Judge unavailable',
          error: 'Old execution message',
          rubricScores: [],
        },
      },
      1,
    );
    expect(result).toMatchObject({
      verdict: 'judge_error',
      error: 'Judge unavailable',
      passCount: 0,
    });
    expect(result.score).toBeUndefined();
    expect(result.threads).toEqual([{ status: 'judge_error' }]);
  });

  it('uses explicit Judge provenance over stale passed flags and scores', () => {
    expect(
      summarizeCaseResult(
        {
          testCaseId: 'case',
          topicId: 'topic',
          status: 'passed',
          passed: true,
          score: 1,
          evalResult: {
            errorPhase: 'judge',
            error: 'Judge unavailable',
            rubricScores: [{ rubricId: 'r', score: 1 }],
          },
        },
        1,
      ),
    ).toMatchObject({ verdict: 'judge_error', score: undefined, passCount: 0 });
  });

  it('keeps valid thread passes visible while marking a partially graded case incomplete', () => {
    const result = summarizeCaseResult(
      {
        testCaseId: 'case',
        topicId: 'topic',
        status: 'judge_error',
        score: null,
        evalResult: {
          threads: [
            { threadId: 'a', status: 'passed', passed: true },
            { threadId: 'b', status: 'judge_error', passed: true, judgeError: 'Judge timeout' },
            { threadId: 'c', status: 'judge_error', passed: true },
          ],
        },
      },
      3,
    );
    expect(result.passCount).toBe(1);
    expect(result.verdict).toBe('judge_error');
    expect(result.error).toBe('Judge timeout');
    expect(result.score).toBeUndefined();
    expect(result.threads.map(({ status }) => status)).toEqual([
      'passed',
      'judge_error',
      'judge_error',
    ]);
  });

  it('retains genuine zero-score model failures as failures', () => {
    expect(
      summarizeCaseResult(
        {
          testCaseId: 'case',
          topicId: 'topic',
          status: 'failed',
          passed: false,
          score: 0,
          evalResult: { rubricScores: [{ rubricId: 'r', score: 0, reason: 'Rule violated' }] },
        },
        1,
      ),
    ).toMatchObject({ verdict: 'failed', score: 0, reason: 'Rule violated' });
  });
});
