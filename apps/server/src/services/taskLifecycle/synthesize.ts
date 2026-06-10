import type { BriefType, TaskItem } from '@lobechat/types';

/** Inputs for the brief-emission rule. Pure data, no I/O. */
export interface ShouldEmitTopicBriefInput {
  hasReviewConfigEnabled: boolean;
  /** True when content is empty / whitespace-only / a trivial acknowledgement. */
  isTrivialContent: boolean;
  reason: string;
  reviewTerminated: boolean;
  task: Pick<TaskItem, 'automationMode'> | null;
}

/**
 * Three-state result so the caller can tell "rule has a definite answer" from
 * "rule is not equipped to decide — defer to the LLM judge".
 *
 * - `'yes'` / `'no'` — deterministic; persist as-is with `source: 'rule'`.
 * - `'unknown'` — pure rules can't tell; caller invokes `chainJudgeBriefEmit`
 *   and records the LLM's verdict with `source: 'llm-judge'`.
 */
export interface ShouldEmitTopicBriefResult {
  emit: 'no' | 'unknown' | 'yes';
  reason: string;
}

/**
 * Decide whether a completed topic should produce a synthesized brief.
 *
 * Pure function — caller wires inputs from `task` / `reason` / etc. Keeping
 * the rule pure makes it easy to unit-test and to reason about.
 *
 * Conclusive branches:
 * - `'yes'` — scheduled tick (contractually owes the user a brief every
 *   run); execution error (the user must be told the run failed). Note:
 *   today the error branch in `onTopicComplete` builds its own urgent
 *   error brief inline, so this rule only fires once that path is folded
 *   into `synthesizeTopicBrief`. The verdict is correct ahead of time.
 * - `'no'` — review-judge already produced a brief upstream, review is
 *   configured (judge owns the next run), or trivial content on a manual
 *   tick. Heartbeat used to be `'no'` here too, but is now deferred to the
 *   judge: most heartbeat ticks are mid-loop noise, but the occasional one
 *   surfaces something the user would want to see, and that judgment
 *   requires reading the content.
 *
 * Non-conclusive branch:
 * - `'unknown'` — heartbeat tick, OR non-trivial content on a manual /
 *   non-scheduled task with no review configured. Caller defers to
 *   `chainJudgeBriefEmit`.
 */
export const shouldEmitTopicBrief = (
  input: ShouldEmitTopicBriefInput,
): ShouldEmitTopicBriefResult => {
  if (input.reason === 'error') return { emit: 'yes', reason: 'execution-error' };
  if (input.reviewTerminated) return { emit: 'no', reason: 'judge-handled' };
  // The judge path may not have terminated (e.g. review disabled or threw),
  // but if review is configured we still defer to it on subsequent runs.
  if (input.hasReviewConfigEnabled) return { emit: 'no', reason: 'review-config-enabled' };
  if (input.task?.automationMode === 'heartbeat') {
    return { emit: 'unknown', reason: 'heartbeat-needs-judge' };
  }
  if (input.task?.automationMode === 'schedule') {
    return { emit: 'yes', reason: 'scheduled-tick' };
  }
  if (input.isTrivialContent) {
    return { emit: 'no', reason: 'trivial-content' };
  }
  return { emit: 'unknown', reason: 'needs-llm-judge' };
};

/** Heuristic for "this content isn't a real delivery". */
export const isTrivialAssistantContent = (content?: string): boolean => {
  if (!content) return true;
  const trimmed = content.trim();
  if (trimmed.length < 16) return true;
  return false;
};

/**
 * Pick the brief type for the auto-synthesis path.
 *
 * For now we only emit `result` briefs — we treat every non-skipped topic
 * completion as a delivery moment. Adding `insight` (mid-process observation)
 * is a future product call.
 */
export const selectBriefType = (_input: ShouldEmitTopicBriefInput): BriefType => 'result';

/**
 * Pick the brief priority. `result` briefs default to `normal` so they show up
 * in the inbox without paging the user. Reserved for future heuristics.
 */
export const selectBriefPriority = (_input: ShouldEmitTopicBriefInput): string => 'normal';
