import type { EvalBenchmarkRubric, RubricConfigLLM } from '@lobechat/types';

import type { MatchContext, MatchResult } from './types';

const DEFAULT_SYSTEM_ROLE = [
  'You are an expert evaluation judge. Your task is to score how well an AI output meets the given criteria.',
  '',
  'Scoring rules:',
  '- Score 1.0: The output fully satisfies the criteria.',
  '- Score 0.0: The output completely fails to meet the criteria.',
  '- Use intermediate values (e.g. 0.3, 0.5, 0.7) for partial matches.',
  '',
  'Respond with a JSON object containing "score" (number 0-1) and "reason" (brief explanation).',
].join('\n');

const JUDGE_SCORE_SCHEMA: Record<string, unknown> = {
  additionalProperties: false,
  properties: {
    reason: { description: 'Brief explanation for the score', type: 'string' },
    score: { description: 'Score from 0.0 to 1.0', maximum: 1, minimum: 0, type: 'number' },
  },
  required: ['score', 'reason'],
  type: 'object',
};

function buildJudgeUserPrompt(
  criteria: string,
  actual: string,
  expected: string | undefined,
): string {
  const parts = [`[Criteria]\n${criteria}`, `[Output]\n${actual}`];
  if (expected) {
    parts.push(`[Expected]\n${expected}`);
  }
  return parts.join('\n\n');
}

export const matchLLMRubric = async (
  actual: string,
  expected: string | undefined,
  rubric: EvalBenchmarkRubric,
  context?: MatchContext,
): Promise<MatchResult> => {
  if (!context?.generateObject) {
    return { passed: false, reason: 'LLM judge not available', score: 0 };
  }

  const cfg = rubric.config as RubricConfigLLM;
  const criteria = cfg.criteria || 'Evaluate whether the output is correct and helpful.';
  const model = cfg.model || context.judgeModel;

  if (!model) {
    return { passed: false, reason: 'No judge model configured', score: 0 };
  }

  try {
    const result = await context.generateObject({
      messages: [
        { content: cfg.systemRole || DEFAULT_SYSTEM_ROLE, role: 'system' },
        { content: buildJudgeUserPrompt(criteria, actual, expected), role: 'user' },
      ],
      model,
      provider: cfg.provider,
      schema: JUDGE_SCORE_SCHEMA,
    });

    const score = Math.max(0, Math.min(1, result.score));
    const threshold = rubric.threshold ?? 0.6;

    return {
      passed: score >= threshold,
      reason: result.reason,
      score,
    };
  } catch (error) {
    return {
      passed: false,
      reason: `LLM judge failed: ${error instanceof Error ? error.message : String(error)}`,
      score: 0,
    };
  }
};
