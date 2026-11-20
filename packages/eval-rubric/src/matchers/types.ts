import type { EvalRuleVerdict } from '@lobechat/types';

export interface GenerateObjectPayload {
  messages: { content: string; role: 'system' | 'user' }[];
  model: string;
  provider?: string;
  schema: Record<string, unknown>;
}

/** What a judge call returns: the fields the payload's schema asked for. */
export interface JudgeObject {
  [key: string]: unknown;
  reason?: string;
  score?: number;
}

export interface MatchContext {
  generateObject?: (payload: GenerateObjectPayload) => Promise<JudgeObject>;
  /**
   * What the agent did while producing the output, for criteria about actions
   * rather than the reply text: tool calls and their results, and the state
   * they left behind. Only LLM-judged rubrics read it.
   */
  judgeEvidence?: string;
  /** Max attempts for the LLM judge before giving up (transient flakes / missing score). Default 3. */
  judgeMaxAttempts?: number;
  judgeModel?: string;
}

export interface MatchResult {
  /**
   * The rubric decides pass/fail by itself: a case fails when a gating rubric
   * fails, whatever the weighted score says. Set by rubrics with a binary
   * verdict, such as the rule checklist.
   */
  gating?: boolean;
  /** Grading failed; passed/score are diagnostic placeholders, not a quality verdict. */
  judgeError?: string;
  passed: boolean;
  reason?: string;
  score: number;
  /** Per-rule verdicts of a rule checklist. */
  verdicts?: EvalRuleVerdict[];
}
