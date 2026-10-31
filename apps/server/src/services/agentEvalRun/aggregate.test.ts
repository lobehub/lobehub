import type { EvalThreadResult } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { evaluateAndFinalizeRun } from './aggregate';

const passing = (id: string): EvalThreadResult => ({
  passed: true,
  status: 'passed',
  threadId: id,
});
const topic = (threads: EvalThreadResult[]) => ({
  evalResult: { cost: 0.03, passAllK: false, passAtK: true, threads },
  passed: true,
  runId: 'run',
  score: 1,
  status: 'passed',
  topicId: 'topic',
});

describe('complete sample quality metrics', () => {
  it.each(['error', 'timeout', 'judge_error', 'external'] as const)(
    'excludes historical passed rows containing a %s attempt',
    async (status) => {
      const metrics = await evaluateAndFinalizeRun({
        run: { config: { k: 3 }, id: 'run' },
        runTopics: [topic([passing('1'), passing('2'), { passed: false, status, threadId: '3' }])],
      });
      expect(metrics.passedCases).toBe(0);
      expect(metrics.failedCases).toBe(0);
      expect(metrics.passAllAt).toBeUndefined();
      expect(metrics.passAnyAt).toBeUndefined();
      expect(metrics.passAllK).toBeUndefined();
      expect(metrics.passAtK).toBeUndefined();
      expect(metrics.totalCost).toBe(0.03);
      const countKey = {
        error: 'errorCases',
        timeout: 'timeoutCases',
        judge_error: 'judgeErrorCases',
        external: 'externalCases',
      }[status];
      expect(metrics[countKey]).toBe(1);
    },
  );

  it('recognizes legacy no-output failures without reclassifying step caps', async () => {
    for (const error of [
      'No assistant output',
      'Reached the step limit (20) without a final answer',
    ]) {
      const metrics = await evaluateAndFinalizeRun({
        run: { config: { k: 3 }, id: 'run' },
        runTopics: [
          topic([
            passing('1'),
            passing('2'),
            { error, passed: false, status: 'failed', threadId: '3' },
          ]),
        ],
      });
      expect(metrics.errorCases).toBe(error === 'No assistant output' ? 1 : 0);
      expect(metrics.passAllAt?.['3']).toBe(error === 'No assistant output' ? undefined : 0);
    }
  });

  it('does not publish complete pass estimates for missing attempts or mixed valid/error cases', async () => {
    for (const runTopics of [
      [topic([passing('1'), passing('2')])],
      [
        topic([passing('1'), passing('2'), passing('3')]),
        { ...topic([]), status: 'error', topicId: 'other' },
      ],
    ]) {
      const metrics = await evaluateAndFinalizeRun({
        run: { config: { k: 3 }, id: 'run' },
        runTopics,
      });
      expect(metrics.passAllAt).toBeUndefined();
      expect(metrics.errorCases).toBe(1);
      expect(metrics.failedCases).toBe(0);
    }
  });

  it('retains the combinatorial estimate for complete valid attempts', async () => {
    const metrics = await evaluateAndFinalizeRun({
      run: { config: { k: 4 }, id: 'run' },
      runTopics: [
        topic([
          passing('1'),
          passing('2'),
          passing('3'),
          { passed: false, status: 'failed', threadId: '4' },
        ]),
      ],
    });
    expect(metrics.passAllAt?.['3']).toBe(0.25);
    expect(metrics.passAnyAt?.['3']).toBe(1);
    expect(metrics.errorCases).toBe(0);
  });
});

describe('historical grading evidence', () => {
  it.each([null, undefined])(
    'requires a boolean verdict for pass@1, even with a terminal status (passed=%s)',
    async (passed) => {
      for (const status of ['passed', 'failed']) {
        const metrics = await evaluateAndFinalizeRun({
          run: { id: 'run' },
          runTopics: [{ passed, runId: 'run', status, topicId: 'topic' }],
        });
        expect(metrics).toMatchObject({ errorCases: 1, failedCases: 0, passedCases: 0 });
        expect(metrics.passAllAt).toBeUndefined();
      }
    },
  );

  it.each([false, true])(
    'honors legacy judge errorPhase on a passed row (threaded=%s)',
    async (threaded) => {
      const metrics = await evaluateAndFinalizeRun({
        run: { config: { k: threaded ? 2 : 1 }, id: 'run' },
        runTopics: [
          {
            ...topic([]),
            evalResult: threaded
              ? { threads: [passing('1'), { ...passing('2'), errorPhase: 'judge' }] }
              : { errorPhase: 'judge' },
          },
        ],
      });
      expect(metrics).toMatchObject({ failedCases: 0, judgeErrorCases: 1, passedCases: 0 });
      expect(metrics.passAllAt).toBeUndefined();
    },
  );
});
