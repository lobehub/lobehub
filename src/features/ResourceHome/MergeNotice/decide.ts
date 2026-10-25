export type MergeNoticeDecision = 'mark-seen' | 'show' | 'wait' | 'none';

interface MergeNoticeInput {
  /**
   * Pages or files exist in the current scope; `undefined` while unknown. This
   * catches users who only ever worked inside a workspace, whose personal
   * conversation count is zero.
   */
  hasContent?: boolean;
  /** The user has chatted before (personal-scope messages or agents). */
  hasConversation: boolean;
  /** User state (and with it the preference) has loaded. */
  ready: boolean;
  /** The notice was already acknowledged. */
  seen: boolean;
}

/**
 * Who sees "Pages and Resources are now Docs": only people who knew the old
 * layout — they chatted before, or have pages or files here — and only once.
 * A newcomer with nothing here never knew either, so their first Docs visit
 * marks the notice seen instead; otherwise it would surface after their first
 * chat and announce a change they never experienced.
 */
export const decideMergeNotice = ({
  hasContent,
  hasConversation,
  ready,
  seen,
}: MergeNoticeInput): MergeNoticeDecision => {
  if (!ready) return 'wait';
  if (seen) return 'none';
  if (hasConversation || hasContent) return 'show';
  // No conversation: wait for the content check before calling them new.
  return hasContent === undefined ? 'wait' : 'mark-seen';
};
