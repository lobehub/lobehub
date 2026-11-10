export type BriefPriority = 'info' | 'normal' | 'urgent';

const PRIORITY_RANK: Record<BriefPriority, number> = { info: 2, normal: 1, urgent: 0 };

/**
 * The column is free text with an `info` default, and older or tool-written rows
 * may carry anything — read every unknown value as `info`, the same bucket the
 * server's unresolved-feed ordering drops it into.
 */
export const resolveBriefPriority = (priority: string | null | undefined): BriefPriority =>
  priority === 'urgent' || priority === 'normal' ? priority : 'info';

export const briefPriorityRank = (priority: string | null | undefined): number =>
  PRIORITY_RANK[resolveBriefPriority(priority)];
