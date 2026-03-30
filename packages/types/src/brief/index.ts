export interface BriefAction {
  /** Action identifier, e.g. 'approve', 'reject', 'feedback' */
  key: string;
  /** Display label, e.g. "✅ 确认开始", "💬 修改意见" */
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

/** Default actions by brief type */
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
  result: [
    { key: 'approve', label: '✅ 通过', type: 'resolve' },
    { key: 'feedback', label: '💬 修改意见', type: 'comment' },
  ],
};
