import type { ILobeAgentRuntimeErrorType } from '@lobechat/types';

/**
 * One entry in the pattern registry.
 *
 * Patterns are matched against the upstream error message via either substring
 * inclusion or regex test. Substring matching is the default and preferred form
 * because it's cheap, debuggable, and resilient to whitespace.
 *
 * A pattern can be scoped to a specific `provider` or upstream `errorType` when
 * the same substring could otherwise produce false positives across providers.
 */
export interface ErrorPattern {
  /** Code produced when this pattern matches. */
  code: ILobeAgentRuntimeErrorType;

  /** Optional upstream errorType scope. When set, only matches errors carrying that errorType. */
  errorType?: string;

  /** Match rule. */
  match:
    | { kind: 'substring'; value: string; caseInsensitive?: boolean }
    | { kind: 'regex'; value: RegExp };

  /** Short note on origin / why the pattern is here. */
  note?: string;

  /** Optional provider scope (single key or list). When set, only matches errors from that provider. */
  provider?: string | string[];
}
