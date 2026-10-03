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

/**
 * A persisted account, as a provider needs to act on it.
 *
 * `credential` is the one field that is not part of a normal read: the service
 * supplies the decrypted secret only on the paths allowed to use it (sending,
 * inbound signature verification) and never on list/detail.
 */
export interface AgentAccountRef {
  /** Decrypted credential, present only on trusted internal paths. */
  credential?: Record<string, string> | null;
  id: string;
  /** The handle that routes to this account: address, number, login. */
  identifier: string;
  kind: AgentAccountKind;
  /** Provider-side non-secret handles (inboxId, chatId, …). */
  metadata: Record<string, unknown>;
  provider: string;
}

/** Who the account is being opened for. */
export interface AgentAccountProvisionInput {
  agentId: string;
  /** Human label for the new account, when the provider can set one. */
  displayName?: string;
  userId: string;
  workspaceId?: string;
}

/**
 * What provisioning produced.
 *
 * `credential` is returned only when the provider mints a per-account secret
 * (an inbox webhook signing key, for example); the caller encrypts it with the
 * KeyVaults gatekeeper and never hands it back to a read.
 */
export interface AgentAccountProvisionResult {
  credential?: Record<string, string>;
  /** Non-secret display facts for the stored credential. */
  credentialHint?: AgentAccountCredentialHint;
  displayName?: string;
  identifier: string;
  metadata?: Record<string, unknown>;
}

/**
 * A raw inbound delivery, before any trust decision.
 *
 * `body` is the exact bytes the signature covers — parsing it for routing is
 * allowed, trusting it is not.
 */
export interface AgentAccountInboundRequest {
  body: string;
  headers: Record<string, string | undefined>;
}

/** A delivery whose signature has been verified, still in provider shape. */
export interface AgentAccountInboundEvent {
  /** Provider delivery id; the replay-dedupe key. */
  eventId: string;
  payload: unknown;
}

/**
 * The narrow contract a transport implements so an agent can own an address
 * with it.
 *
 * Deliberately small: there is no typing / read-receipt / reaction / capability
 * matrix / bot-credential surface here, because an account is the agent's own
 * identity rather than a bot inside someone else's platform. Anything a
 * provider needs beyond this lives in its own `metadata`.
 */
export interface AgentAccountProvider<K extends AgentAccountKind = AgentAccountKind> {
  /** What the account can do — declared here and persisted onto the account. */
  readonly capabilities: AgentAccountCapabilities;
  /** The account kind this provider issues. */
  readonly kind: K;
  /** Normalize a verified delivery into the transport-neutral message. */
  normalizeInbound: (
    event: AgentAccountInboundEvent,
    ref: AgentAccountRef,
  ) => Promise<AgentAccountInboundMessage | null>;

  /** Stable provider id (`agent-mail`, `linq`, …); the account's `provider` value. */
  readonly provider: string;

  /** Idempotent open. Runs before the account row exists. */
  provision: (input: AgentAccountProvisionInput) => Promise<AgentAccountProvisionResult>;

  /** Idempotent release. Called while revoking, before the row is marked revoked. */
  release: (ref: AgentAccountRef) => Promise<void>;

  /**
   * Extract the routing key (the account `identifier`) from an *untrusted*
   * delivery, so the account can be found and its credential used to verify.
   * Returning `undefined` means the delivery cannot be routed at all.
   */
  resolveInboundIdentifier: (request: AgentAccountInboundRequest) => string | undefined;

  send: (
    ref: AgentAccountRef,
    message: AgentAccountOutboundMessage,
  ) => Promise<{ providerMessageId: string }>;

  /**
   * Verify the signature over the raw body and reject replays. Returns `null`
   * for anything forged or already handled, so the caller answers 401/409
   * without the provider leaking which check failed.
   */
  verifyInbound: (
    request: AgentAccountInboundRequest,
    ref: AgentAccountRef,
  ) => Promise<AgentAccountInboundEvent | null>;
}
