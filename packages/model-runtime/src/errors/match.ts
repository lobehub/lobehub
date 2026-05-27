import type { ILobeAgentRuntimeErrorType } from '@lobechat/types';

import { ERROR_PATTERNS, type ErrorPattern } from './patterns';
import { getErrorCodeSpec } from './specs';

export interface MatchInput {
  errorType?: string;
  message?: string;
  provider?: string;
}

export interface MatchResult {
  code: ILobeAgentRuntimeErrorType;
  pattern: ErrorPattern;
}

const matchOne = (pattern: ErrorPattern, input: MatchInput): boolean => {
  if (!input.message) return false;
  if (pattern.errorType && pattern.errorType !== input.errorType) return false;
  if (pattern.provider) {
    const providers = Array.isArray(pattern.provider) ? pattern.provider : [pattern.provider];
    if (!providers.includes(input.provider ?? '')) return false;
  }

  if (pattern.match.kind === 'substring') {
    const value = pattern.match.value;
    if (pattern.match.caseInsensitive) {
      return input.message.toLowerCase().includes(value.toLowerCase());
    }
    return input.message.includes(value);
  }

  return pattern.match.value.test(input.message);
};

/**
 * Walk the pattern registry and return the first matching code, or undefined.
 *
 * Order matters: patterns are evaluated top-to-bottom in `ERROR_PATTERNS`.
 * Provider/errorType scoping should be used when a substring is ambiguous
 * across providers.
 */
export const matchErrorPattern = (input: MatchInput): MatchResult | undefined => {
  if (!input.message) return undefined;
  for (const pattern of ERROR_PATTERNS) {
    if (matchOne(pattern, input)) return { code: pattern.code, pattern };
  }
  return undefined;
};

/**
 * True when the error originates from the user side and should be excluded
 * from operational failure metrics.
 *
 * The decision is:
 *   1. If `errorType` is a known code with `countAsFailure: false` in the spec
 *      table, treat as user-side.
 *   2. Otherwise, try to classify by matching the message against the pattern
 *      registry and look up the resulting code's spec.
 *
 * Pattern matching runs whenever a message is present, regardless of
 * `errorType`. The harness sometimes misclassifies (e.g. TPM as
 * ExceededContextWindow, network drops as 500), so the message-pattern step
 * is the gating mechanism — a substring hit overrides the upstream label.
 */
export const isUserSideError = (errorType?: string, message?: string): boolean => {
  if (errorType) {
    const spec = getErrorCodeSpec(errorType);
    if (spec && !spec.countAsFailure) return true;
  }

  if (message) {
    const match = matchErrorPattern({ errorType, message });
    if (match) {
      const spec = getErrorCodeSpec(match.code);
      if (spec && !spec.countAsFailure) return true;
    }
  }

  return false;
};
