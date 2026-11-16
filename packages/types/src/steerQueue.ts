/**
 * Why a follow-up queued behind a running heterogeneous run (Claude Code, …)
 * is not typed into its live session now and waits for the run to end instead.
 *
 * - `attachments`: it carries attached files.
 * - `selection`: it carries attached selections (quoted text, page context).
 * - `toolSelection`: it selects tools or skills for its turn.
 * - `mentions`: it @-mentions other agents.
 * - `otherAgent`: it is addressed to an agent other than the one running.
 * - `empty`: it has no text to type in.
 * - `imagesNeedNewerCli`: it has pasted images and the run's CLI only takes text.
 * - `behindHeld`: an earlier follow-up waits for the run to end, and the queue keeps its order.
 * - `inputClosed`: the session stopped taking input.
 * - `notListening`: the run's CLI is not taking follow-ups at all — an `lh`
 *   from before live steering, a runtime without it, or a poll loop that stopped.
 */
export const QUEUED_FOLLOW_UP_WAIT_REASONS = [
  'attachments',
  'selection',
  'toolSelection',
  'mentions',
  'otherAgent',
  'empty',
  'imagesNeedNewerCli',
  'behindHeld',
  'inputClosed',
  'notListening',
] as const;

export type QueuedFollowUpWaitReason = (typeof QUEUED_FOLLOW_UP_WAIT_REASONS)[number];
