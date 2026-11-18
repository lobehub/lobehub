import type { EvalBenchmarkRubric, RubricConfigLLM } from '@lobechat/types';

import { judgeErrorResult } from './judgeError';
import type { MatchContext, MatchResult } from './types';

const DEFAULT_SYSTEM_ROLE = [
  'You are an expert evaluation judge. Your task is to score how well an AI output meets the given criteria.',
  'Judge whether the following [response] to [question] is correct or not based on the precise and unambiguous [correct_answer] below.',
  'Your judgement must be in the format and criteria specified below:',
  "extracted_final_answer: The final exact answer extracted from the [response]. Put the extracted answer as 'None' if there is no exact, final answer to extract from the response.",
  'reasoning: Explain why the extracted_final_answer is correct or incorrect based on [correct_answer], focusing only on if there are meaningful differences between [correct_answer] and the extracted_final_answer. Do not comment on any background to the problem, do not attempt to solve the problem, do not argue for any answer different than [correct_answer], focus only on whether the answers match.',
  'Scoring rules:',
  'score: Return 1 only when extracted_final_answer clearly and unambiguously matches [correct_answer], or is within a small margin of error for numerical problems.',
  'score: Return 0 when extracted_final_answer is incorrect, missing, ambiguous, non-equivalent, or when you are uncertain.',
  'Treat uncertainty as incorrect (score = 0).',
  'Respond with a JSON object containing ',
  '"score" (number: 0 or 1)',
  'and "reason" (brief explanation for the judgement).',
].join('\n');

const JUDGE_SCORE_SCHEMA: Record<string, unknown> = {
  additionalProperties: false,
  properties: {
    score: {
      description: 'Binary score for judgement: 1=correct, 0=incorrect/uncertain',
      enum: [0, 1],
      type: 'number',
    },
    reason: { description: 'Brief explanation for the judgement', type: 'string' },
  },
  required: ['score', 'reason'],
  type: 'object',
};

function buildJudgeUserPrompt(
  question: string,
  actual: string,
  expected: string | undefined,
): string {
  const parts = [`[question]\n${question}`, `[response]\n${actual}`];
  if (expected) {
    parts.push(`[correct_answer]\n${expected}`);
  }
  return parts.join('\n\n');
}

export const matchLLMEq = async (
  question: string,
  actual: string,
  expected: string | undefined,
  rubric: EvalBenchmarkRubric,
  context?: MatchContext,
): Promise<MatchResult> => {
  if (!context?.generateObject) {
    return judgeErrorResult('LLM judge not available');
  }

  const cfg = (rubric.config ?? {}) as RubricConfigLLM;
  const model = cfg.model || context.judgeModel;

  if (typeof model !== 'string' || !model.trim()) {
    return judgeErrorResult('No judge model configured');
  }

  try {
    const result = await context.generateObject({
      messages: [
        { content: cfg.systemRole || DEFAULT_SYSTEM_ROLE, role: 'system' },
        { content: buildJudgeUserPrompt(question, actual, expected), role: 'user' },
      ],
      model,
      provider: cfg.provider,
      schema: JUDGE_SCORE_SCHEMA,
    });

    if ((result?.score !== 0 && result?.score !== 1) || typeof result?.reason !== 'string') {
      return judgeErrorResult('LLM judge did not return a valid binary score and reason');
    }
    const score = result.score;

    return {
      passed: score === 1,
      reason: result?.reason,
      score,
    };
  } catch (error) {
    return judgeErrorResult(
      `LLM judge failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
