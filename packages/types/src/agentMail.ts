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

/**
 * The mail views a person files mail into. Drafts are not here: they are not
 * mail yet and live in their own table. `starred` is a view over the others.
 */
export const AGENT_MAIL_FOLDERS = ['inbox', 'sent', 'starred', 'trash'] as const;
export type AgentMailFolder = (typeof AGENT_MAIL_FOLDERS)[number];

/** What a draft or a person's send does: open a conversation or answer one. */
export const AGENT_MAIL_COMPOSE_MODES = ['compose', 'reply', 'replyAll', 'forward'] as const;
export type AgentMailComposeMode = (typeof AGENT_MAIL_COMPOSE_MODES)[number];
