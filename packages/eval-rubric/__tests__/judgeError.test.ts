import type { EvalBenchmarkRubric } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { evaluate, match } from '../src';
import type { JudgeObject, MatchContext } from '../src/matchers/types';

const rubric = (type: EvalBenchmarkRubric['type']): EvalBenchmarkRubric => ({
  config: { criteria: 'Must: Answer the question.' },
  id: type,
  name: type,
  type,
  weight: 1,
});

const judgeTypes = ['answer-relevance', 'llm-rubric', 'rule-checklist'] as const;
const params = (type: (typeof judgeTypes)[number]) => ({
  actual: 'The candidate answer',
  expected: 'The expected answer',
  input: 'The question',
  rubric: rubric(type),
});

describe.each(judgeTypes)('%s Judge failure isolation', (type) => {
  it('marks unavailable and unconfigured judges without throwing', async () => {
    const generateObject = vi.fn<NonNullable<MatchContext['generateObject']>>();
    expect(await match(params(type))).toHaveProperty('judgeError', 'LLM judge not available');
    expect(await match(params(type), { generateObject })).toHaveProperty(
      'judgeError',
      'No judge model configured',
    );
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('marks an exhausted provider failure', async () => {
    const generateObject = vi.fn().mockRejectedValue(new Error('Provider unavailable'));
    const result = await match(params(type), {
      generateObject,
      judgeMaxAttempts: 2,
      judgeModel: 'judge',
    });
    expect(result).toMatchObject({
      judgeError: 'LLM judge failed: Provider unavailable',
      passed: false,
    });
  });

  it.each([null, {}, { score: '0' }, { score: Number.NaN }, { score: 0 }])(
    'marks malformed response %j',
    async (response) => {
      const result = await match(params(type), {
        generateObject: vi.fn().mockResolvedValue(response),
        judgeMaxAttempts: 1,
        judgeModel: 'judge',
      });
      expect(result.judgeError).toEqual(expect.any(String));
      expect(result.passed).toBe(false);
    },
  );

  it('keeps a valid zero verdict distinct from Judge failure', async () => {
    const response: JudgeObject =
      type === 'rule-checklist'
        ? {
            rules: [{ index: 1, reason: 'The answer is wrong.', verdict: 'violated' }],
            summary: 'Not satisfied.',
          }
        : { reason: 'The answer is wrong.', score: 0 };
    const result = await match(params(type), {
      generateObject: vi.fn().mockResolvedValue(response),
      judgeModel: 'judge',
    });
    expect(result).toMatchObject({ passed: false, score: 0 });
    expect(result.judgeError).toBeUndefined();
  });
});

describe('checklist response contract', () => {
  const validRow = { index: 1, reason: 'No evidence.', verdict: 'unverifiable' };

  // Each `rules` is the whole array the judge returned. (A bare array table
  // would be spread into arguments, so the callback would see only its first
  // element and never the empty or duplicated lists.)
  it.each([
    { rules: [] },
    { rules: [null] },
    { rules: [{ ...validRow, index: 0 }] },
    { rules: [{ ...validRow, index: '1' }] },
    { rules: [{ ...validRow, index: 2 }] },
    { rules: [{ reason: 'No evidence.', verdict: 'unverifiable' }] },
    { rules: [{ index: 1, verdict: 'satisfied' }] },
    { rules: [{ ...validRow, verdict: 'unknown' }] },
    { rules: [validRow, validRow] },
  ])('marks missing or invalid rule verdicts $rules', async ({ rules }) => {
    const result = await match(params('rule-checklist'), {
      generateObject: vi.fn().mockResolvedValue({ rules, summary: '' }),
      judgeMaxAttempts: 1,
      judgeModel: 'judge',
    });
    expect(result.judgeError).toEqual(expect.any(String));
    expect(result.passed).toBe(false);
  });

  it('keeps an explicit unverifiable verdict valid', async () => {
    const result = await match(params('rule-checklist'), {
      generateObject: vi.fn().mockResolvedValue({ rules: [validRow], summary: '' }),
      judgeModel: 'judge',
    });
    expect(result).toMatchObject({ passed: false, score: 0 });
    expect(result.judgeError).toBeUndefined();
    expect(result.verdicts?.[0].verdict).toBe('unverifiable');
  });

  it('rejects a response missing its required summary', async () => {
    const result = await match(params('rule-checklist'), {
      generateObject: vi.fn().mockResolvedValue({ rules: [validRow] }),
      judgeMaxAttempts: 1,
      judgeModel: 'judge',
    });
    expect(result.judgeError).toEqual(expect.any(String));
  });

  it('requires every rule once while accepting reordered one-based verdicts', async () => {
    const request = params('rule-checklist');
    request.rubric.config = { criteria: 'Must: First.\nMust: Second.' };
    const generateObject = vi.fn();
    const context = { generateObject, judgeMaxAttempts: 1, judgeModel: 'judge' };
    for (const rules of [[validRow], [validRow, validRow]]) {
      generateObject.mockResolvedValue({ rules, summary: '' });
      expect((await match(request, context)).judgeError).toEqual(expect.any(String));
    }
    generateObject.mockResolvedValue({
      rules: [{ ...validRow, index: 2 }, validRow],
      summary: 'Insufficient evidence for both.',
    });
    const result = await match(request, context);
    expect(result.judgeError).toBeUndefined();
    expect(result.verdicts?.map((item) => item.rule)).toEqual(['Must: First.', 'Must: Second.']);
  });

  it('marks an empty checklist as a grading configuration failure', async () => {
    const request = params('rule-checklist');
    request.rubric.config = { criteria: 'Must: ' };
    const generateObject = vi.fn();
    const result = await match(request, { generateObject, judgeModel: 'judge' });
    expect(result.judgeError).toBe('No checklist rules configured');
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('retries malformed verdicts and clears the error after recovery', async () => {
    const generateObject = vi
      .fn()
      .mockResolvedValueOnce({ rules: [], summary: '' })
      .mockResolvedValueOnce({
        rules: [{ ...validRow, verdict: 'satisfied' }],
        summary: 'Recovered.',
      });
    const result = await match(params('rule-checklist'), { generateObject, judgeModel: 'judge' });
    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ passed: true, score: 1 });
    expect(result.judgeError).toBeUndefined();
  });
});

describe('evaluation Judge failure propagation', () => {
  it('reports missing grading configuration', async () => {
    const result = await evaluate({
      actual: 'Answer',
      rubrics: [],
      testCase: { input: 'Question' },
    });
    expect(result.judgeError).toBe('No rubrics configured');
  });

  it('keeps rubric diagnostics and fails closed when another rubric scores highly', async () => {
    const result = await evaluate(
      {
        actual: 'Answer',
        rubrics: [{ ...rubric('equals'), weight: 9 }, rubric('llm-rubric')],
        testCase: { expected: 'Answer', input: 'Question' },
      },
      { passThreshold: 0.6 },
    );
    expect(result.score).toBe(0.9);
    expect(result.passed).toBe(false);
    expect(result.judgeError).toContain('LLM judge not available');
    expect(result.rubricResults[1].judgeError).toBe('LLM judge not available');
  });

  it.each([true, false])(
    'preserves an error alongside a successful any-of candidate (%s)',
    async (errorFirst) => {
      const generateObject = vi.fn();
      if (errorFirst) {
        generateObject
          .mockRejectedValueOnce(new Error('Judge unavailable'))
          .mockResolvedValueOnce({ reason: 'Match', score: 1 });
      } else {
        generateObject
          .mockResolvedValueOnce({ reason: 'Match', score: 1 })
          .mockRejectedValueOnce(new Error('Judge unavailable'));
      }
      const result = await evaluate(
        {
          actual: 'Answer',
          rubrics: [rubric('llm-rubric')],
          testCase: { expected: '["A","B"]', input: 'Question' },
        },
        { matchContext: { generateObject, judgeMaxAttempts: 1, judgeModel: 'judge' } },
      );
      expect(generateObject).toHaveBeenCalledTimes(2);
      expect(result.passed).toBe(false);
      expect(result.judgeError).toContain('Judge unavailable');
      expect(result.rubricResults[0].judgeError).toContain('Judge unavailable');
    },
  );
});
