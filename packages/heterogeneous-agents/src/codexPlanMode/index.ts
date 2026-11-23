import type { ChatTopicMetadata, CodexCollaborationMode } from '@lobechat/types';
import { isCodexCollaborationMode } from '@lobechat/types';

/*
 * Browser-safe slice of the Codex Plan switch (Better Coding Experience lab):
 * the mode report a native Codex run emits and the topic patch it maps to.
 * The thread logic lives in `codex/CodexThreadSession` (Node only).
 */

/** `step_complete` phase carrying what a native Codex run reports about its collaboration mode. */
export const COLLABORATION_MODE_PHASE = 'collaboration_mode';

/** Tool api name of a completed Codex plan (`ThreadItem { type: 'plan' }`). */
export const CODEX_PROPOSED_PLAN_API_NAME = 'proposed_plan';

/** Plugin state of a `proposed_plan` tool message. */
export interface CodexProposedPlanState {
  plan: {
    /** False while `item/plan/delta` streams; the completed item replaces the text. */
    completed: boolean;
    text: string;
  };
}

export interface CollaborationModeReportData {
  /**
   * The mode Codex says the thread is in (`thread/settings/updated` after
   * `turn/start`, or a mid-run switch).
   */
  collaborationMode?: CodexCollaborationMode;
  phase: typeof COLLABORATION_MODE_PHASE;
  /** The mode this run asked for when Codex reported `collaborationMode`. */
  requested?: CodexCollaborationMode;
}

export const isCollaborationModeReport = (data: unknown): data is CollaborationModeReportData => {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    record.phase === COLLABORATION_MODE_PHASE && isCodexCollaborationMode(record.collaborationMode)
  );
};

/**
 * The topic patch for a collaboration-mode report, shared by the server (runs
 * hosted by `lh hetero exec`) and the desktop renderer (local runs).
 *
 * The Plan switch follows Codex only where Codex disagrees with what the run
 * asked for; a report that merely confirms the request writes nothing, so it
 * can never undo a switch the user flipped while the run was going.
 */
export const collaborationModeReportPatch = (
  report: Pick<CollaborationModeReportData, 'collaborationMode' | 'requested'>,
): Pick<ChatTopicMetadata, 'heteroPlanMode'> =>
  report.collaborationMode && report.requested && report.collaborationMode !== report.requested
    ? { heteroPlanMode: report.collaborationMode === 'plan' }
    : {};
