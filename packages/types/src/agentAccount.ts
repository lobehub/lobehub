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

/**
 * A message the agent received on one of its accounts, persisted as the
 * agent's **own first-class inbox** — not a channel message and not a tool
 * result.
 *
 * This is what makes "the agent has an inbox" a state the runtime and the
 * model can read without paying an always-on tool slot for it: each inbound
 * delivery becomes one of these rows, and the runtime hands the unread ones to
 * the model as context.
 */
export interface AgentInboxMessage {
  /** The account that received it — the routing key resolved to an account id. */
  accountId: string;
  agentId: string;
  /** Verification codes pulled out of the body (3–8 digits), for the `wait` primitive. */
  codes: string[];
  createdAt: Date;
  /** Address the message came from. */
  from: string;
  id: string;
  kind: AgentAccountKind;
  /** When it was first read by the agent; `null` while unread. */
  readAt: Date | null;
  receivedAt: Date;
  subject: string | null;
  text: string;
  /** Provider-normalized thread key, when the provider supplies one. */
  threadKey: string | null;
  /** The agent's own identifier the message was delivered to. */
  to: string;
}

/**
 * The inbox as one glance: how much is waiting. Injected into the model's
 * context so it knows it has mail without querying.
 *
 * Deliberately carries no message content. Sender, subject and body are
 * written by whoever emails or texts the agent, so they must never reach the
 * system prompt — the model reads them on demand through the account tool,
 * fenced as untrusted input.
 */
export interface AgentInboxSummary {
  unreadCount: number;
}

/** One account as the runtime context shows it — credential-safe by construction. */
export interface AgentAccountContextItem {
  capabilities: AgentAccountCapabilities;
  displayName?: string | null;
  /** The handle the outside world reaches the agent at. */
  identifier: string;
  kind: AgentAccountKind;
  provider: string;
  status: AgentAccountStatus;
}

/**
 * The agent's identity as first-class runtime state: which addresses it owns
 * and what is waiting in its inbox. This is what replaces a resident
 * `lobe-mailbox` tool slot — the model is *told* who it is instead of having
 * to ask through a tool every turn.
 */
export interface AgentAccountContext {
  accounts: AgentAccountContextItem[];
  inbox: AgentInboxSummary;
}

/** A message the agent sends from one of its accounts. */
export interface AgentAccountOutboundMessage {
  attachments?: AgentAccountAttachment[];
  /**
   * Provider-side message id this send answers — the `providerMessageId` of the
   * inbound message being replied to. A transport that threads by id (mail's
   * `replyToMessage`) answers inside that message's thread; one that threads by
   * key ignores it and uses {@link threadKey} instead.
   */
  replyToProviderMessageId?: string;
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
  /**
   * Whether a live account already routes on `identifier` for this provider.
   * Providers that bind from a finite operator inventory (Linq numbers) use it
   * to pick a free unit instead of colliding on the routing key.
   */
  isIdentifierHeld?: (identifier: string) => Promise<boolean>;
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
  /**
   * The signature is valid but this delivery id was already accepted — a
   * provider retry or a captured request played back. It is acknowledged
   * without producing a message, so a legitimate retry is not read as forged.
   */
  duplicate?: boolean;
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
   * Forget the replay claim {@link verifyInbound} took for a delivery, so the
   * provider's retry of it is processed instead of acknowledged as a
   * duplicate. Called when handling a verified delivery failed transiently and
   * the webhook answers with a retryable status. Optional: a provider that
   * keeps no claim has nothing to release.
   */
  releaseInbound?: (eventId: string) => Promise<void>;

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
   * Verify the signature over the raw body and recognise replays. Returns
   * `null` for anything forged, so the caller answers 401 without the provider
   * leaking which check failed; an authentic delivery id seen before comes back
   * flagged `duplicate` and is acknowledged without producing a message.
   */
  verifyInbound: (
    request: AgentAccountInboundRequest,
    ref: AgentAccountRef,
  ) => Promise<AgentAccountInboundEvent | null>;
}
