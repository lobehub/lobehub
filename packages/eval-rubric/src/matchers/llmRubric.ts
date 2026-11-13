import type { EvalBenchmarkRubric, RubricConfigLLM } from '@lobechat/types';

import { judgeErrorResult } from './judgeError';
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
  input: string | undefined,
  evidence: string | undefined,
): string {
  const parts = [`[Criteria]\n${criteria}`];
  // Surface the task input (e.g. the prompt/draft/context the output responds
  // to) so the judge can score the output against what it was supposed to do,
  // not just against the criteria text in isolation.
  if (input) {
    parts.push(`[Input]\n${input}`);
  }
  parts.push(`[Output]\n${actual}`);
  // The output is only the final reply. Criteria about what the agent did (call
  // a tool, save something) can only be judged from the actions themselves.
  if (evidence) {
    parts.push(
      `[Evidence]\nWhat the AI did while producing the output. Use it for criteria about actions or resulting state.\n${evidence}`,
    );
  }
  if (expected) {
    parts.push(`[Expected]\n${expected}`);
  }
  return parts.join('\n\n');
}

export interface MatchLLMRubricParams {
  actual: string;
  context?: MatchContext;
  expected?: string;
  input?: string;
  rubric: EvalBenchmarkRubric;
}

export const matchLLMRubric = async ({
  actual,
  context,
  expected,
  input,
  rubric,
}: MatchLLMRubricParams): Promise<MatchResult> => {
  if (!context?.generateObject) {
    return judgeErrorResult('LLM judge not available');
  }

  const cfg = (rubric.config ?? {}) as RubricConfigLLM;
  if (cfg.criteria !== undefined && typeof cfg.criteria !== 'string') {
    return judgeErrorResult('Invalid judge criteria');
  }
  const criteria = cfg.criteria || 'Evaluate whether the output is correct and helpful.';
  const model = cfg.model || context.judgeModel;

  if (typeof model !== 'string' || !model.trim()) {
    return judgeErrorResult('No judge model configured');
  }

  const messages = [
    { content: cfg.systemRole || DEFAULT_SYSTEM_ROLE, role: 'system' as const },
    {
      content: buildJudgeUserPrompt(criteria, actual, expected, input, context.judgeEvidence),
      role: 'user' as const,
    },
  ];
  const threshold = rubric.threshold ?? 0.6;
  const maxAttempts = Math.max(1, context.judgeMaxAttempts ?? 3);

  // Retry transient judge flakes — a thrown error or a malformed response with no
  // usable score. The judge occasionally returns no parseable score under load;
  // a single bad sample shouldn't auto-fail an otherwise-good output.
  let lastResult = judgeErrorResult('LLM judge did not return a score');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await context.generateObject({
        messages,
        model,
        provider: cfg.provider,
        schema: JUDGE_SCORE_SCHEMA,
      });

      // Note: a valid score can be 0 (output fully fails the criteria), so check
      // the type rather than truthiness — `!result.score` would drop real zeros.
      if (typeof result?.score !== 'number' || !Number.isFinite(result.score)) {
        lastResult = judgeErrorResult('LLM judge did not return a score');
        continue;
      }
      if (result.score < 0 || result.score > 1) {
        lastResult = judgeErrorResult('LLM judge returned an out-of-range score');
        continue;
      }
      if (typeof result.reason !== 'string') {
        lastResult = judgeErrorResult('LLM judge did not return a reason');
        continue;
      }
      return { passed: result.score >= threshold, reason: result.reason, score: result.score };
    } catch (error) {
      lastResult = judgeErrorResult(
        `LLM judge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return lastResult;
};
