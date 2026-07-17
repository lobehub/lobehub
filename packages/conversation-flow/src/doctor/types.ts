/**
 * Topic Doctor Types
 *
 * A diagnosis describes what the reader cannot show the user, plus the minimal set of
 * writes that would make it visible again. Damage that cannot be undone (content that never
 * reached the database) is reported too, but carries no repair — saying so plainly is more
 * useful than a button that deletes rows and calls it a fix.
 */

export type TopicIssueKind =
  /** A run kept writing under its pre-fork anchor while a new user turn started under the same parent */
  | 'concurrent-fork'
  /** A toolless signal turn parented off an assistant: the main chain filters it out and the signal collectors never scan it */
  | 'orphan-signal-turn'
  /** `metadata.activeBranchIndex` is out of bounds, so the branch resolver skips the whole subtree */
  | 'stale-branch-index'
  /** A new turn was sent with no parent mid-conversation, so a whole section detached into its own root */
  | 'segment-split'
  /** A run of assistant rows whose content and tool calls never landed — unrecoverable */
  | 'lost-content';

export interface TopicIssue {
  /** Messages the reader does not render. Empty for issues that damage content rather than reachability. */
  hiddenMessageIds: string[];
  kind: TopicIssueKind;
  /** Messages whose content is gone for good (`lost-content` only) */
  lostMessageIds?: string[];
  /** The message the issue is anchored on */
  messageId: string;
  /**
   * The detached section reconnected by this repair (`segment-split` only). These render
   * today, but on their own root — out of order and severed from the model's context chain.
   */
  reattachedMessageIds?: string[];
  /**
   * False when the shape is understood but nothing can be safely rewritten — the issue is
   * still reported so the user knows why the conversation looks the way it does.
   */
  repairable: boolean;
}

export type RepairOp =
  | { messageId: string; parentId: string; type: 'reparent' }
  | { index: number; messageId: string; type: 'set-branch-index' };

export interface TopicDiagnosis {
  /** Messages that exist but are not rendered, attributable to an issue */
  hiddenCount: number;
  issues: TopicIssue[];
  /** Ops to apply, in order. Empty when nothing is safely repairable. */
  patch: RepairOp[];
}
