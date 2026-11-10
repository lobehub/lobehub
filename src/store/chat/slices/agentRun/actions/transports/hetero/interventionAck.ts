import type { ToolIntervention } from '@lobechat/types';

export const preserveSkippedIntervention = (
  incoming: ToolIntervention,
  previous?: ToolIntervention,
): ToolIntervention =>
  incoming.status === 'rejected' &&
  incoming.rejectedReason === 'user_cancelled' &&
  previous?.skipped === true
    ? { ...incoming, skipped: true }
    : incoming;
