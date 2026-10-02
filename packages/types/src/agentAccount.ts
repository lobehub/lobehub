/**
 * Agent accounts — the identity assets an agent owns.
 *
 * An agent may hold several accounts: a `mail` address, a `phone` number, a
 * `wallet`, or a third-party `service` login. Each one is its own row, belongs
 * to the agent (not to a workspace integration), and may carry credentials.
 *
 * Kinds and statuses are growing domains, so they are plain unions here and the
 * columns stay plain `text` typed by them — onboarding a kind is a type-only
 * change with no migration.
 */

/** The sorts of identity an agent can own. */
export const AGENT_ACCOUNT_KINDS = ['mail', 'phone', 'wallet', 'service'] as const;
export type AgentAccountKind = (typeof AGENT_ACCOUNT_KINDS)[number];

/** Lifecycle of one account. */
export const AGENT_ACCOUNT_STATUSES = ['provisioning', 'active', 'suspended', 'revoked'] as const;
export type AgentAccountStatus = (typeof AGENT_ACCOUNT_STATUSES)[number];

/**
 * What the account can do, declared by whoever provisions it rather than
 * inferred from its kind: a `service` account may be login-only, a `phone`
 * account may be receive-only during warm-up.
 */
export interface AgentAccountCapabilities {
  /** The credential can be used to log in to a third-party service. */
  login?: boolean;
  /** Messages can arrive at this account. */
  receive: boolean;
  /** The agent can send from this account. */
  send: boolean;
  /** The agent can sign with this account (on-chain wallet, later). */
  sign?: boolean;
}

/**
 * Non-secret facts about the stored credential, safe to return from any read
 * API: enough for a person to recognise *which* secret is installed and when it
 * expires, never enough to use it.
 *
 * The secret itself lives as ciphertext in `agent_accounts.credentials` and is
 * never read back out.
 */
export interface AgentAccountCredentialHint {
  /** ISO timestamp after which the credential stops being valid. */
  expiresAt?: string;
  /** Masked tail safe to display, e.g. `•••• 4242`. */
  masked?: string;
  /** ISO timestamp of the last write or rotation. */
  rotatedAt?: string;
  /** Login the credential belongs to, when it is a username/password pair. */
  username?: string;
}

/** An attachment carried by an inbound or outbound account message. */
export interface AgentAccountAttachment {
  mimeType: string;
  name?: string;
  size?: number;
  url: string;
}

/**
 * A message addressed **to** the agent's account, normalized by its provider.
 * This is the shape every transport converges on, so the inbox and the runtime
 * never learn platform-specific semantics.
 */
export interface AgentAccountInboundMessage {
  attachments?: AgentAccountAttachment[];
  /** Address the message came from. */
  from: string;
  /** Provider-side message id, used for dedupe and idempotent replies. */
  providerMessageId: string;
  receivedAt: Date;
  subject?: string;
  text: string;
  /**
   * Provider-normalized thread key (`undefined` = a fresh thread). Providers
   * derive it themselves; nothing platform-specific leaks past this field.
   */
  threadKey?: string;
  /** Address it was delivered to — the agent's own identifier. */
  to: string;
}

/** A message the agent sends from one of its accounts. */
export interface AgentAccountOutboundMessage {
  attachments?: AgentAccountAttachment[];
  subject?: string;
  text: string;
  /** Reply within this thread when the provider supports it. */
  threadKey?: string;
  to: string;
}
