import type { AgentAccountContextItem } from '@lobechat/types';

export const AgentAccountIdentifier = 'lobe-agent-account';

export const AgentAccountApiName = {
  /** List the addresses this agent owns. */
  listAccounts: 'listAccounts',
  /** Send a message from one of the agent's accounts. */
  sendMessage: 'sendMessage',
  /**
   * Block until a message arrives on one of the agent's accounts (or time out).
   * The primitive for "wait for the verification code".
   */
  waitForMessage: 'waitForMessage',
} as const;

export interface ListAccountsArgs {}

export interface SendMessageArgs {
  /** Which account to send from. Defaults to the agent's first send-capable one. */
  accountId?: string;
  subject?: string;
  text: string;
  /** Reply within this thread when the provider supports it. */
  threadKey?: string;
  /** The address to send to. */
  to: string;
}

export interface WaitForMessageArgs {
  accountId?: string;
  /** Only match a message from this sender. */
  from?: string;
  /** Start looking at messages received after this ISO timestamp; defaults to now. */
  since?: string;
  /** Case-insensitive substring the subject must contain. */
  subjectIncludes?: string;
  /** How long to wait, in ms. Clamped to the tool's own budget. */
  timeoutMs?: number;
}

/** One message handed back by `waitForMessage`. */
export interface WaitedInboundMessage {
  /** Verification codes found in the body (usually a single one). */
  codes: string[];
  from: string;
  receivedAt: string;
  subject?: string;
  text: string;
}

export type WaitForMessageResult =
  { matched: true; message: WaitedInboundMessage } | { matched: false; reason: 'timed-out' };

export interface ListAccountsResult {
  accounts: AgentAccountContextItem[];
}

export interface SendMessageResult {
  providerMessageId: string;
}
