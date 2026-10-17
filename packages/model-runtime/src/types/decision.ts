import type { ModelUsage } from '@lobechat/types';

import type { ModelPricingContext } from './pricing';

export type DecisionJsonValue =
  string | number | boolean | null | DecisionJsonValue[] | { [key: string]: DecisionJsonValue };

/**
 * Asks how likely a yes/no proposition is to be true.
 * Sent as a System One `noul` question.
 */
export interface DecisionPredicateQuestion {
  /** Guidance for when the proposition is true and when it is false. */
  criteria: { false: string; true: string };
  instructions: string;
  type: 'predicate';
}

/**
 * Asks the model to pick exactly one option from a caller-defined set.
 */
export interface DecisionChoiceQuestion {
  /** Option key → guidance describing when to pick it. */
  criteria: Record<string, string>;
  instructions: string;
  type: 'choice';
}

/**
 * Asks the model to place the state on an ordered rubric.
 */
export interface DecisionScoreQuestion {
  /** Rubric level descriptions ordered from lowest to highest; level indices start at 0. */
  criteria: string[];
  instructions: string;
  type: 'score';
}

export type DecisionQuestion =
  DecisionChoiceQuestion | DecisionPredicateQuestion | DecisionScoreQuestion;

export type DecisionQuestions = Record<string, DecisionQuestion>;

/**
 * Typed questions about one shared state, answered with probabilities instead of generated text.
 *
 * The shape follows the System One request (named questions + criteria) used by TypeSafe,
 * OpenRouter, and vLLM Semantic Router, with the vendor term `noul` renamed to `predicate`.
 * @see https://openrouter.ai/docs/api/api-reference/systemone/submit-a-system-one-request
 */
export interface DecisionPayload<Q extends DecisionQuestions = DecisionQuestions> {
  model: string;
  /** Question name → question. Names come back as the keys of `answers`. */
  questions: Q;
  /** The content every question is evaluated against. */
  state: string | DecisionJsonValue[] | { [key: string]: DecisionJsonValue };
}

export interface DecisionPredicateAnswer {
  /** Probability (0–1) that the proposition is true. */
  probability: number;
  type: 'predicate';
}

export interface DecisionChoiceAnswer<K extends string = string> {
  choice: K;
  /**
   * Provider-defined concentration of `probabilities`. It is not the probability of being
   * correct, so do not threshold it like a predicate probability.
   */
  confidence?: number;
  /** Option key → probability, one entry per requested option. */
  probabilities: Record<K, number>;
  type: 'choice';
}

export interface DecisionScoreAnswer {
  confidence?: number;
  /** Probability per rubric level, in the same order as the requested `criteria`. */
  probabilities: number[];
  /** Probability-weighted mean of the zero-based level index; it may fall between levels. */
  score: number;
  type: 'score';
}

/**
 * The model declined this question. Other questions in the same call may still be answered,
 * so this is an answer rather than an error and never triggers a route fallback.
 */
export interface DecisionRefusalAnswer {
  reason?: string;
  type: 'refusal';
}

export type DecisionAnswer<Q extends DecisionQuestion = DecisionQuestion> =
  | DecisionRefusalAnswer
  | (Q extends DecisionPredicateQuestion
      ? DecisionPredicateAnswer
      : Q extends DecisionChoiceQuestion
        ? DecisionChoiceAnswer<Extract<keyof Q['criteria'], string>>
        : DecisionScoreAnswer);

export interface DecisionResponse<Q extends DecisionQuestions = DecisionQuestions> {
  answers: { [K in keyof Q]: DecisionAnswer<Q[K]> };
  id?: string;
  /** Model that actually served the request, possibly a dated version of the requested id. */
  model: string;
  /** Upstream provider that served the request, when reported. */
  provider?: string;
}

export interface DecisionOptions {
  headers?: Record<string, string>;
  /** Metadata passed to hooks (billing, tracing, route attempts), e.g. `trigger`. */
  metadata?: Record<string, unknown>;
  /**
   * Receives the provider-reported token usage (with `cost` when the model has pricing)
   * after a successful decision.
   */
  onUsage?: (usage: ModelUsage) => void | Promise<void>;
  pricingContext?: ModelPricingContext;
  signal?: AbortSignal;
  /**
   * userId for the request
   */
  user?: string;
}
