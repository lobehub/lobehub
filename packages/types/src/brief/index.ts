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
    { key: 'approve', label: '✅ 确认', type: 'resolve' },
    { key: 'feedback', label: '💬 修改意见', type: 'comment' },
  ],
  error: [
    { key: 'retry', label: '🔄 重试', type: 'resolve' },
    { key: 'feedback', label: '💬 反馈', type: 'comment' },
  ],
  insight: [{ key: 'acknowledge', label: '👍 知悉', type: 'resolve' }],
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
