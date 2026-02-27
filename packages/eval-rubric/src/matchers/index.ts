import type { EvalBenchmarkRubric } from '@lobechat/types';

import { matchAnyOf } from './anyOf';
import { matchContains } from './contains';
import { matchEndsWith } from './endsWith';
import { matchEquals } from './equals';
import { matchJsonSchema } from './jsonSchema';
import { matchLevenshtein } from './levenshtein';
import { matchLLMRubric } from './llmRubric';
import { matchNumeric } from './numeric';
import { matchRegex } from './regex';
import { matchStartsWith } from './startsWith';
import type { MatchContext, MatchResult } from './types';

export type { GenerateObjectPayload, MatchContext, MatchResult } from './types';

/**
 * Run a single rubric matcher against actual vs expected
 */
export const match = async (
  params: { actual: string; expected: string | undefined; rubric: EvalBenchmarkRubric },
  context?: MatchContext,
): Promise<MatchResult> => {
  const { actual, expected, rubric } = params;
  const { type, config } = rubric;

  switch (type) {
    case 'equals': {
      return matchEquals(actual, expected);
    }

    case 'contains': {
      return matchContains(actual, expected);
    }

    case 'starts-with': {
      return matchStartsWith(actual, expected);
    }

    case 'ends-with': {
      return matchEndsWith(actual, expected);
    }

    case 'regex': {
      return matchRegex(actual, config);
    }

    case 'any-of': {
      return matchAnyOf(actual, config);
    }

    case 'numeric': {
      return matchNumeric(actual, expected, config);
    }

    case 'levenshtein': {
      return matchLevenshtein(actual, expected, config);
    }

    case 'llm-rubric': {
      return matchLLMRubric(actual, expected, rubric, context);
    }

    case 'json-schema': {
      return matchJsonSchema(actual, config);
    }

    default: {
      return {
        passed: false,
        reason: `Unsupported rubric type: ${type}`,
        score: 0,
      };
    }
  }
};
