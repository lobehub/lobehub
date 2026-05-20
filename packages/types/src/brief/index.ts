export interface BriefAction {
  /** Action identifier, e.g. 'approve', 'reject', 'feedback' */
  key: string;
  /** Display label, e.g. "✅ Confirm Start", "💬 Revisions" */
  label: string;
  /**
   * Action type:
   * - 'resolve': directly mark brief as resolved
   * - 'comment': prompt for text input, then resolve
   * - 'link': navigate to a URL (no resolution)
   */
  type: 'resolve' | 'comment' | 'link';
  /** URL for 'link' type actions */
  url?: string;
}

/**
 * Default actions by brief type.
 *
 * Note: `result` briefs intentionally have no defaults — they are terminal and
 * render a fixed single-button UI (approve → completes the task). Custom
 * actions on result briefs are dropped at creation time.
 */
export const DEFAULT_BRIEF_ACTIONS: Record<string, BriefAction[]> = {
  decision: [
    { key: 'approve', label: '✅ Confirm', type: 'resolve' },
    { key: 'feedback', label: '💬 Request changes', type: 'comment' },
  ],
  error: [
    { key: 'retry', label: '🔄 Retry', type: 'resolve' },
    { key: 'feedback', label: '💬 Feedback', type: 'comment' },
  ],
  insight: [{ key: 'acknowledge', label: '👍 Acknowledged', type: 'resolve' }],
};

/** Brief type — must match DEFAULT_BRIEF_ACTIONS keys and DB schema comment */
export type BriefType = 'decision' | 'error' | 'insight' | 'result';

/**
 * A single artifact (currently only documents) referenced from a brief.
 * Programmatically collected during topic completion, not produced by the LLM.
 */
export interface BriefArtifactDocument {
  id: string;
  kind: string | null;
  title: string | null;
}

export interface BriefArtifacts {
  documents?: BriefArtifactDocument[];
}

/** Agent Signal-owned Brief metadata namespace. */
export interface BriefAgentSignalMetadata {
  /** Future Agent Signal domains can extend this namespace without top-level collisions. */
  [key: string]: unknown;
  /** Nightly self-review state written by Agent Signal maintenance runs. */
  nightlySelfReview?: unknown;
}

/** Freeform Brief metadata namespaced by feature owner. */
export interface BriefMetadata {
  /** Other feature namespaces remain possible without schema churn. */
  [key: string]: unknown;
  /** Agent Signal extension metadata. */
  agentSignal?: BriefAgentSignalMetadata;
}
