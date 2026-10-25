/** A mailbox as a mail header names it. */
export interface AgentMailAddress {
  address: string;
  name?: string;
}

/**
 * An attachment as the mail provider (lobe.id) holds it. Only the descriptor
 * is stored in LobeHub; the bytes stay with the provider and are fetched
 * through it by `providerMessageId` + `index`.
 */
export interface AgentMailAttachment {
  contentType?: string;
  filename?: string;
  /** Position within the provider message; the provider's download key. */
  index: number;
  size?: number;
}

/** Whether the agent received the mail or sent it. */
export const AGENT_MAIL_DIRECTIONS = ['inbound', 'outbound'] as const;
export type AgentMailDirection = (typeof AGENT_MAIL_DIRECTIONS)[number];

/** What an agent inbox item points at. Mail is the first source; others join without a migration. */
export const AGENT_INBOX_SOURCE_TYPES = ['mail'] as const;
export type AgentInboxSourceType = (typeof AGENT_INBOX_SOURCE_TYPES)[number];
