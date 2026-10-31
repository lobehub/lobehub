import type { EvalBenchmarkRubric } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { matchRuleChecklist, parseChecklistRules } from '../ruleChecklist';
import type { GenerateObjectPayload, JudgeObject, MatchContext } from '../types';

const CRITERIA = [
  'Must: Submit exactly one paper market buy order for 10 shares of O.',
  'Must: Report both order IDs',
  '(paper_order_001, paper_order_002).',
  'Must not: Say the stop order filled.',
].join('\n');

const rubric = (config: any = { criteria: CRITERIA }): EvalBenchmarkRubric => ({
  config,
  id: 'rules',
  name: 'rules',
  type: 'rule-checklist',
  weight: 1,
});

describe('parseChecklistRules', () => {
  it('splits Must / Must not lines and keeps continuation lines with their rule', () => {
    expect(parseChecklistRules(CRITERIA)).toEqual([
      { kind: 'must', text: 'Submit exactly one paper market buy order for 10 shares of O.' },
      { kind: 'must', text: 'Report both order IDs (paper_order_001, paper_order_002).' },
      { kind: 'must-not', text: 'Say the stop order filled.' },
    ]);
  });

  it('accepts bullets, numbering and either colon', () => {
    expect(parseChecklistRules('- Must： keep it\n2) MUST NOT: drop it')).toEqual([
      { kind: 'must', text: 'keep it' },
      { kind: 'must-not', text: 'drop it' },
    ]);
  });

  it('treats criteria without rule lines as one rule', () => {
    expect(parseChecklistRules('Grade the attempt against the rules of the case.')).toEqual([
      { kind: 'rule', text: 'Grade the attempt against the rules of the case.' },
    ]);
  });
});

describe('matchRuleChecklist', () => {
  const generateObject = vi.fn<(payload: GenerateObjectPayload) => Promise<JudgeObject>>();
  const context: MatchContext = {
    generateObject,
    judgeEvidence:
      'Tool calls, in order:\n1. alpaca.submit_order({...}) -> {"id":"paper_order_001"}',
    judgeModel: 'judge-model',
  };

  beforeEach(() => generateObject.mockReset());

  it('passes only when every rule is satisfied and scores the share of satisfied rules', async () => {
    generateObject.mockResolvedValue({
      rules: [
        { index: 1, reason: 'One buy order in the evidence.', verdict: 'satisfied' },
        { index: 2, reason: 'Both ids reported.', verdict: 'satisfied' },
        { index: 3, reason: 'Nothing says the stop filled.', verdict: 'satisfied' },
      ],
      summary: 'Clean execution.',
    });

    const result = await matchRuleChecklist({ actual: 'Done.', context, rubric: rubric() });

    expect(result).toMatchObject({ gating: true, passed: true, score: 1 });
    expect(result.verdicts).toHaveLength(3);
    expect(result.reason).toContain('Clean execution.');
    expect(result.reason).toContain('1. ✓ Must: Submit exactly one paper market buy order');
  });

  it('fails the case on a single violated rule, however high the score', async () => {
    generateObject.mockResolvedValue({
      rules: [
        { index: 1, reason: 'ok', verdict: 'satisfied' },
        { index: 2, reason: 'ok', verdict: 'satisfied' },
        { index: 3, reason: 'The output says the stop "filled".', verdict: 'violated' },
      ],
      summary: 'Mostly right.',
    });

    const result = await matchRuleChecklist({ actual: 'Stop filled.', context, rubric: rubric() });

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.667);
    expect(result.reason).toContain(
      '3. ✗ Must not: Say the stop order filled. — The output says the stop "filled".',
    );
    expect(result.verdicts?.[2]).toEqual({
      reason: 'The output says the stop "filled".',
      rule: 'Must not: Say the stop order filled.',
      verdict: 'violated',
    });
  });

  it('counts an explicit unverifiable rule as not satisfied', async () => {
    generateObject.mockResolvedValue({
      rules: [
        { index: 1, reason: 'ok', verdict: 'satisfied' },
        { index: 2, reason: 'Evidence is insufficient.', verdict: 'unverifiable' },
        { index: 3, reason: 'Evidence does not show the order ids.', verdict: 'unverifiable' },
      ],
      summary: '',
    });

    const result = await matchRuleChecklist({ actual: 'Done.', context, rubric: rubric() });

    expect(result.passed).toBe(false);
    expect(result.judgeError).toBeUndefined();
    expect(result.verdicts?.map((v) => v.verdict)).toEqual([
      'satisfied',
      'unverifiable',
      'unverifiable',
    ]);
  });

  it('shows the judge the numbered rules, the output and the evidence', async () => {
    generateObject.mockResolvedValue({ rules: [], summary: '' });

    await matchRuleChecklist({ actual: 'Done.', context, input: 'Buy 10 O', rubric: rubric() });

    const prompt = generateObject.mock.calls[0][0].messages[1].content;
    expect(prompt).toContain('[Rules]\n1. Must: Submit exactly one paper market buy order');
    expect(prompt).toContain('3. Must not: Say the stop order filled.');
    expect(prompt).toContain('[Input]\nBuy 10 O');
    expect(prompt).toContain('[Output]\nDone.');
    expect(prompt).toContain('[Evidence]');
    expect(prompt).toContain('alpaca.submit_order');
    expect(generateObject.mock.calls[0][0].model).toBe('judge-model');
  });

  it('retries a judge answer without verdicts, then fails', async () => {
    generateObject.mockResolvedValue({ reason: 'fine', score: 1 });

    const result = await matchRuleChecklist({
      actual: 'Done.',
      context: { ...context, judgeMaxAttempts: 2 },
      rubric: rubric(),
    });

    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      gating: true,
      passed: false,
      reason: 'LLM judge did not return rule verdicts',
      score: 0,
    });
  });

  it('fails without a judge', async () => {
    const result = await matchRuleChecklist({ actual: 'Done.', rubric: rubric() });

    expect(result).toMatchObject({
      gating: true,
      passed: false,
      reason: 'LLM judge not available',
    });
  });
});
