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

export interface ShouldEmitTopicBriefResult {
  emit: boolean;
  reason?: string;
}

/**
 * Decide whether a completed topic should produce a synthesized brief.
 *
 * Pure function — caller wires inputs from `task` / `reason` / etc. Keeping
 * the rule pure makes it easy to unit-test and to reason about.
 *
 * The error and judge paths build their own briefs upstream; we skip them here
 * to avoid duplicates. Heartbeat/schedule ticks default to "no brief" because
 * each tick is just a status nudge, not a delivery moment — that policy can be
 * revisited later if we want periodic insight briefs.
 */
export const shouldEmitTopicBrief = (
  input: ShouldEmitTopicBriefInput,
): ShouldEmitTopicBriefResult => {
  if (input.reason === 'error') return { emit: false, reason: 'error-branch-handled' };
  if (input.reviewTerminated) return { emit: false, reason: 'judge-handled' };
  // The judge path may not have terminated (e.g. review disabled or threw),
  // but if review is configured we still defer to it on subsequent runs.
  if (input.hasReviewConfigEnabled) return { emit: false, reason: 'review-config-enabled' };
  if (input.task?.automationMode) return { emit: false, reason: 'automation-tick' };
  if (input.isTrivialContent) return { emit: false, reason: 'trivial-content' };
  return { emit: true };
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
