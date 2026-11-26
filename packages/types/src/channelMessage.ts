import type {
  ChannelMessageMetadata,
  ChannelMessageRoutingSource,
  ChannelMessageRoutingStatus,
} from './channel';
import type { ChannelMessageKind } from './channelAsk';

/**
 * One public message row (`channel_messages`), declared here as a contract instead of being
 * inferred from the Drizzle table: readers outside the database package depend on this shape, so
 * a column change has to update it deliberately. `channel.rowTypes.check.ts` next to the table
 * keeps the two in step at compile time.
 */
export interface ChannelMessage {
  /** Actual Agent sender; NULL once that author is deleted. */
  agentId: string | null;
  channelId: string;
  content: string;
  createdAt: Date;
  id: string;
  /** What the message is; its payload lives in `metadata.<kind>`. */
  kind: ChannelMessageKind;
  /** Mentioned member ids. Mentioned Agents run; mentioned people are only notified. */
  mentions: string[];
  metadata: ChannelMessageMetadata | null;
  /** Agent member ids that actually received a job for this message. */
  recipientMemberIds: string[];
  replyToId: string | null;
  /** Client retry key for a human message; run identity for a published reply. */
  requestKey: string;
  /** Incremented each time routing starts, so a late decision cannot overwrite a retry. */
  routingAttempt: number;
  /** Human-readable explanation of why these recipients (or none) were chosen. */
  routingReason: string | null;
  /** Where the recipients came from; NULL until routing settles, and on replies. */
  routingSource: ChannelMessageRoutingSource | null;
  routingStatus: ChannelMessageRoutingStatus;
  sequence: number;
  threadId: string | null;
  /** Actual human sender, not the owner/requester of an Agent reply; NULL once deleted. */
  userId: string | null;
}
