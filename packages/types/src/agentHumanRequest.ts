import type { AgentAccountKind } from './agentAccount';

/**
 * Agent human requests — the things an agent cannot do without its owner.
 *
 * A request binds one concrete action (today: sending a message from one of
 * the agent's own addresses) to one human answer, and the server performs the
 * action only after that answer arrives:
 *
 * - `approval`: the human sends (optionally after editing) or discards the
 *   action. Outbound mail / SMS / iMessage to anyone who is not simply being
 *   answered on their own thread goes through here.
 * - `secret`: the action carries a `{{secret}}` slot (e.g. "Your code is
 *   {{secret}}") that only the human can fill. The value travels as an Agent
 *   Secret Channel (ASC/1) HPKE envelope sealed to a per-request key; the
 *   server opens it, performs the bound action and drops it in the same call.
 *   The value never reaches the model, the message history, a tool result, a
 *   trace or a log — the agent only learns *that* it was provided.
 *
 * The agent never decides a request. Its tool call only parks the action;
 * clients (web, desktop, the native toby apps) render the request as a card,
 * and the decision comes from the owner's authenticated call. The outcome
 * reaches the agent as a fresh turn, so an asynchronous answer hours later on
 * a phone works the same as an immediate one at a desk.
 *
 * Kinds and statuses are growing domains: plain unions, stored as `text`.
 */

/** The two families of card. */
export const AGENT_HUMAN_REQUEST_TYPES = ['approval', 'secret'] as const;
export type AgentHumanRequestType = (typeof AGENT_HUMAN_REQUEST_TYPES)[number];

/**
 * Lifecycle. Mapped to what the user sees:
 *
 * | status      | approval card          | secret card          |
 * | ----------- | ---------------------- | -------------------- |
 * | `pending`   | Waiting for you        | Waiting for input    |
 * | `executing` | Sending… (transient)   | Checking… (transient)|
 * | `completed` | Sent                   | Done                 |
 * | `declined`  | Discarded              | Skipped              |
 * | `expired`   | Expired                | Expired              |
 * | `failed`    | Failed — retry         | Failed               |
 */
export const AGENT_HUMAN_REQUEST_STATUSES = [
  'pending',
  'executing',
  'completed',
  'declined',
  'expired',
  'failed',
] as const;
export type AgentHumanRequestStatus = (typeof AGENT_HUMAN_REQUEST_STATUSES)[number];

/** Statuses after which nothing can change the request any more. */
export const AGENT_HUMAN_REQUEST_FINAL_STATUSES: readonly AgentHumanRequestStatus[] = [
  'completed',
  'declined',
  'expired',
];

/** What the human is asked to type (ASC registry kinds the cards support). */
export const AGENT_SECRET_KINDS = ['otp', 'password', 'token'] as const;
export type AgentSecretKind = (typeof AGENT_SECRET_KINDS)[number];

/** The placeholder a secret action's text carries exactly once. */
export const AGENT_SECRET_SLOT = '{{secret}}';

/**
 * The bound action: one message from one of the agent's own addresses.
 *
 * `from` / `channel` are resolved by the server from the account, never taken
 * from the model, so the card always names the real sending address.
 */
export interface AgentSendMessageAction {
  accountId: string;
  /** The sending account's kind: `mail` → email card, `phone` → SMS / iMessage card. */
  channel: AgentAccountKind;
  /** The agent's own address the message goes out from. */
  from: string;
  subject?: string;
  /** Body. A `secret` request's body holds {@link AGENT_SECRET_SLOT} exactly once. */
  text: string;
  /** Reply within this thread when the provider supports it. */
  threadKey?: string;
  to: string;
  type: 'send_message';
}

export type AgentHumanRequestAction = AgentSendMessageAction;

/** Fields the owner may change on an approval card before sending. */
export interface AgentSendMessageEdits {
  subject?: string;
  text?: string;
  to?: string;
}

/**
 * The secret half of a `secret` request: public metadata only.
 *
 * `request` is the signed ASC/1 Request the client seals against. Clients
 * SHOULD pin `request.executor.identityKeyFp` (TOFU) and verify the signature
 * before showing the input, exactly as ASC prescribes.
 */
export interface AgentHumanRequestSecret {
  kind: AgentSecretKind;
  /** System-chosen label; also the redaction placeholder `«secret:<label>»`. */
  label: string;
  /** The ASC/1 Request (`AscRequest` from `@lobechat/secret-channel`). */
  request: Record<string, unknown>;
}

/** What happened when the action ran (no secret value is ever recorded). */
export interface AgentHumanRequestResult {
  /** Set when the owner changed the action before approving. */
  edited?: boolean;
  /** Redacted provider / validation error of the last attempt. */
  error?: string;
  providerMessageId?: string;
}

/** Where the decision came from — for the audit trail and the agent's notice. */
export const AGENT_HUMAN_REQUEST_SURFACES = ['web', 'desktop', 'ios', 'android', 'api'] as const;
export type AgentHumanRequestSurface = (typeof AGENT_HUMAN_REQUEST_SURFACES)[number];

/** One request, as every client renders it. */
export interface AgentHumanRequestItem {
  /** The action the server will perform (after edits, when edited). */
  action: AgentHumanRequestAction;
  agentId: string;
  createdAt: Date;
  decidedAt?: Date | null;
  decidedVia?: AgentHumanRequestSurface | null;
  expiresAt: Date;
  id: string;
  /** The action as the agent first proposed it; present only when edited. */
  originalAction?: AgentHumanRequestAction | null;
  /**
   * The agent's own explanation. Untrusted: render it apart from the system
   * facts (from / to / body), never as the card's title.
   */
  reason?: string | null;
  result?: AgentHumanRequestResult | null;
  secret?: AgentHumanRequestSecret | null;
  status: AgentHumanRequestStatus;
  topicId?: string | null;
  type: AgentHumanRequestType;
}

/** The ASC/1 envelope a client posts to fulfil a secret request. */
export interface AgentSecretEnvelope {
  ct: string;
  enc: string;
  requestId: string;
  sender?: string;
  suite: string;
  v: number;
}

/** The owner's answer to a request. */
export type AgentHumanRequestDecision =
  | { action: 'approve'; edits?: AgentSendMessageEdits }
  | { action: 'decline' }
  | { action: 'retry' }
  | { action: 'fulfill'; envelope: AgentSecretEnvelope };

/** Executor identity clients pin to verify secret requests (ASC TOFU). */
export interface AgentSecretChannelIdentity {
  executorId: string;
  executorName: string;
  identityKeyFp: string;
  identityPublicKey: string;
  suite: string;
}
