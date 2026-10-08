import {
  type AscEnvelope,
  type AscRequest,
  createSecretRedactor,
  isAscError,
  openWithPersistedKey,
  type PersistableRecipientKey,
  utf8Decode,
  wipe,
} from '@lobechat/secret-channel';
import {
  AGENT_SECRET_SLOT,
  type AgentAccountOutboundMessage,
  type AgentHumanRequestAction,
  type AgentHumanRequestDecision,
  type AgentHumanRequestItem,
  type AgentHumanRequestStatus,
  type AgentHumanRequestSurface,
  type AgentHumanRequestType,
  type AgentSecretKind,
  type AgentSendMessageAction,
  type AgentSendMessageEdits,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { AgentHumanRequestModel } from '@/database/models/agentHumanRequest';
import type { AgentHumanRequestRow } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import { buildSecretRequest, describeExecutorIdentity, hashAction } from './secretChannel';

const log = debug('lobe-server:agent-human-request');

/** An approval waits a day: the owner may answer from their phone hours later. */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * A wake that has not confirmed delivery within this window is treated as
 * lost and redelivered on the owner's next read. Long enough that a wake still
 * in flight (starting a run) is not doubled.
 */
export const NOTIFY_REDELIVER_AFTER_MS = 60 * 1000;

/** A new outcome on the same row starts a fresh delivery. */
const RESET_DELIVERY = {
  notifiedAt: null,
  notifyAttemptedAt: null,
  notifyAttempts: 0,
  notifyClaimId: null,
};

const MAX_TEXT_CHARS = 20_000;
const MAX_REASON_CHARS = 500;

/** Something that can seal / unseal the per-request key at rest (KeyVaults). */
export interface AgentHumanRequestKeySealer {
  decrypt: (data: string) => Promise<{ plaintext: string }>;
  encrypt: (data: string) => Promise<string>;
}

/** Performs the bound action (the agent-account send path, once wired). */
export type AgentHumanRequestSender = (
  accountId: string,
  message: AgentAccountOutboundMessage,
) => Promise<{ providerMessageId: string }>;

/**
 * Until an outbound channel is wired in (the agent-account send path), an
 * approved action has nowhere to go: the request moves to `failed` with this
 * message instead of pretending it was sent.
 */
export const unavailableSender: AgentHumanRequestSender = async () => {
  throw new Error('No outbound channel is available to perform this action.');
};

/** Tells the agent what the owner decided (default: a new turn in the topic). */
export interface AgentHumanRequestNotifier {
  notify: (request: AgentHumanRequestItem) => Promise<void>;
}

export interface AgentHumanRequestServiceOptions {
  notifier?: AgentHumanRequestNotifier;
  now?: () => number;
  sealer: AgentHumanRequestKeySealer;
  sender: AgentHumanRequestSender;
  workspaceId?: string;
}

/** Where the parked action came from. */
export interface AgentHumanRequestOrigin {
  agentId: string;
  operationId?: string;
  toolCallId?: string;
  topicId?: string;
}

export type RequestActionInput = Omit<AgentSendMessageAction, 'type'>;

const badRequest = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message });
const conflict = (message: string) => new TRPCError({ code: 'CONFLICT', message });

const errorName = (error: unknown) => (error instanceof Error ? error.name : typeof error);

const clip = (value: string | undefined | null, max: number) =>
  value ? value.slice(0, max) : undefined;

const countSlots = (text: string) => text.split(AGENT_SECRET_SLOT).length - 1;

const normalizeAddress = (value: string) => value.trim().toLowerCase();

export const toAgentHumanRequestItem = (row: AgentHumanRequestRow): AgentHumanRequestItem => ({
  action: row.action,
  agentId: row.agentId,
  createdAt: row.createdAt,
  decidedAt: row.decidedAt,
  decidedVia: row.decidedVia,
  expiresAt: row.expiresAt,
  id: row.id,
  originalAction: row.originalAction,
  reason: row.reason,
  result: row.result,
  // The ASC request is only useful while it can still be answered.
  secret:
    row.secret && row.status === 'pending'
      ? row.secret
      : row.secret
        ? { ...row.secret, request: {} }
        : null,
  status: row.status,
  topicId: row.topicId,
  type: row.type,
});

/**
 * Parks agent actions that need their owner and runs them once answered.
 *
 * The agent side (`requestApproval` / `requestSecret`) only ever creates a
 * pending row; it can neither decide nor read a secret. The owner side
 * (`decide`) is the only path that performs an action, and each decision
 * moves the row with a conditional update, so a double tap — or a phone and a
 * desktop answering at once — runs the action at most once.
 *
 * Secret values exist only inside {@link fulfill}: opened from the HPKE
 * envelope, substituted into the bound action, sent, wiped. They are never
 * returned, stored, logged or passed to the notifier; any echo of the value in
 * a provider error is replaced with `«secret:<label>»` before it is recorded.
 */
export class AgentHumanRequestService {
  private readonly model: AgentHumanRequestModel;
  private readonly options: AgentHumanRequestServiceOptions;

  constructor(db: LobeChatDatabase, userId: string, options: AgentHumanRequestServiceOptions) {
    this.options = options;
    this.model = new AgentHumanRequestModel(db, userId, options.workspaceId);
  }

  private now = () => this.options.now?.() ?? Date.now();

  // ------------------------------------------------------------------ agent side

  /** Park an outbound message for the owner's approval. */
  requestApproval = async (
    origin: AgentHumanRequestOrigin,
    input: RequestActionInput & { reason?: string },
  ): Promise<AgentHumanRequestItem> => {
    const action = this.toAction(input);
    const row = await this.model.create({
      ...this.originColumns(origin),
      action,
      expiresAt: new Date(this.now() + APPROVAL_TTL_MS),
      reason: clip(input.reason, MAX_REASON_CHARS),
      type: 'approval',
    });

    log('approval %s parked for agent %s', row.id, origin.agentId);
    return toAgentHumanRequestItem(row);
  };

  /**
   * Park an outbound message whose text holds `{{secret}}` exactly once,
   * waiting for the owner to fill it through the secure input card.
   */
  requestSecret = async (
    origin: AgentHumanRequestOrigin,
    input: RequestActionInput & { kind: AgentSecretKind; reason?: string },
  ): Promise<AgentHumanRequestItem> => {
    const action = this.toAction(input);
    if (countSlots(action.text) !== 1) {
      throw badRequest(`The message text must contain ${AGENT_SECRET_SLOT} exactly once.`);
    }
    // Sending the value to the agent's own address would put it straight into
    // the agent's inbox — the one reader the secure input exists to bypass.
    if (normalizeAddress(action.to) === normalizeAddress(action.from)) {
      throw badRequest("A secret cannot be sent to the agent's own address.");
    }

    const reason = clip(input.reason, MAX_REASON_CHARS);
    const { key, label, request } = await buildSecretRequest({
      action,
      kind: input.kind,
      now: this.now(),
      reason,
      runId: origin.operationId,
    });

    const row = await this.model.create({
      ...this.originColumns(origin),
      action,
      expiresAt: new Date(request.expiresAt),
      reason,
      recipientKey: await this.options.sealer.encrypt(JSON.stringify(key)),
      secret: { kind: input.kind, label, request: request as unknown as Record<string, unknown> },
      type: 'secret',
    });

    log('secret request %s parked for agent %s', row.id, origin.agentId);
    return toAgentHumanRequestItem(row);
  };

  // ------------------------------------------------------------------ owner side

  identity = () => describeExecutorIdentity();

  list = async (params: {
    agentId?: string;
    limit?: number;
    status?: AgentHumanRequestStatus[];
    topicId?: string;
    type?: AgentHumanRequestType;
  }): Promise<AgentHumanRequestItem[]> => {
    await this.model.expireDue(new Date(this.now()));
    await this.redeliverOutcomes();
    const rows = await this.model.list(params);
    return rows.map(toAgentHumanRequestItem);
  };

  get = async (id: string): Promise<AgentHumanRequestItem> => {
    await this.model.expireDue(new Date(this.now()));
    await this.redeliverOutcomes();
    return toAgentHumanRequestItem(await this.requireRow(id));
  };

  /** The owner's answer. The only path that performs an action. */
  decide = async (
    id: string,
    decision: AgentHumanRequestDecision,
    via: AgentHumanRequestSurface = 'api',
  ): Promise<AgentHumanRequestItem> => {
    const row = await this.requireOpenRow(id);

    switch (decision.action) {
      case 'approve': {
        if (row.type !== 'approval') throw badRequest('Only an approval request can be approved.');
        return this.approve(row, decision.edits, via);
      }
      case 'retry': {
        if (row.type !== 'approval') throw badRequest('Only an approval request can be retried.');
        return this.retry(row);
      }
      case 'decline': {
        return this.decline(row, via);
      }
      case 'fulfill': {
        if (row.type !== 'secret') throw badRequest('Only a secret request takes a secret.');
        // The wire type keeps `suite` a plain string; an unknown suite is
        // refused by the open step (UNSUPPORTED_VERSION), not by the type.
        return this.fulfill(row, decision.envelope as AscEnvelope, via);
      }
    }
  };

  // ------------------------------------------------------------------ transitions

  private approve = async (
    row: AgentHumanRequestRow,
    edits: AgentSendMessageEdits | undefined,
    via: AgentHumanRequestSurface,
  ) => {
    const edited = this.applyEdits(row.action, edits);
    const changed = edited !== row.action;

    const claimed = await this.model.claim(row.id, ['pending'], {
      action: edited,
      decidedAt: new Date(this.now()),
      decidedVia: via,
      originalAction: changed ? row.action : null,
      status: 'executing',
    });
    if (!claimed) throw conflict('This request was already answered.');

    return this.execute(claimed, { edited: changed });
  };

  private retry = async (row: AgentHumanRequestRow) => {
    const claimed = await this.model.claim(row.id, ['failed'], {
      ...RESET_DELIVERY,
      status: 'executing',
    });
    if (!claimed) throw conflict('Only a failed request can be retried.');

    return this.execute(claimed, { edited: !!claimed.originalAction });
  };

  private decline = async (row: AgentHumanRequestRow, via: AgentHumanRequestSurface) => {
    // A failed approval can still be discarded instead of retried; a failed
    // secret request is already spent (its key is gone), so it stays failed.
    const from: AgentHumanRequestStatus[] =
      row.type === 'approval' ? ['pending', 'failed'] : ['pending'];
    const claimed = await this.model.claim(row.id, from, {
      ...RESET_DELIVERY,
      decidedAt: new Date(this.now()),
      decidedVia: via,
      // A skipped secret request must never be openable afterwards.
      recipientKey: null,
      status: 'declined',
    });
    if (!claimed) throw conflict('This request was already answered.');

    const item = toAgentHumanRequestItem(claimed);
    await this.notify(item);
    return item;
  };

  private fulfill = async (
    row: AgentHumanRequestRow,
    envelope: AscEnvelope,
    via: AgentHumanRequestSurface,
  ) => {
    const request = row.secret?.request as unknown as AscRequest | undefined;
    if (!row.secret || !request?.id) throw badRequest('This request carries no secret channel.');
    const label = row.secret.label;

    // ASC: the key is destroyed before the first decryption attempt, whatever
    // the outcome. A second envelope for the same request can never open.
    const taken = await this.model.takeRecipientKey(row.id, {
      decidedAt: new Date(this.now()),
      decidedVia: via,
    });
    if (!taken) throw conflict('This request was already answered.');

    let secretBytes: Uint8Array | undefined;
    try {
      // The stored action must still be the one the human was shown.
      if (hashAction(taken.row.action) !== request.target.argvHash) {
        return this.fail(taken.row, 'The request changed after it was shown.');
      }

      const key = JSON.parse(
        (await this.options.sealer.decrypt(taken.recipientKey)).plaintext,
      ) as PersistableRecipientKey;

      try {
        secretBytes = await openWithPersistedKey({ envelope, key, now: this.now(), request });
      } catch (error) {
        if (isAscError(error))
          return this.fail(taken.row, `Secure input rejected (${error.code}).`);
        throw error;
      }

      // JS strings cannot be wiped; this one lives only for the send below.
      const secret = utf8Decode(secretBytes);
      const redactor = createSecretRedactor();
      redactor.add(label, secret);

      const action = taken.row.action;
      try {
        const { providerMessageId } = await this.options.sender(action.accountId, {
          subject: action.subject,
          text: action.text.split(AGENT_SECRET_SLOT).join(secret),
          threadKey: action.threadKey,
          to: action.to,
        });
        return this.complete(taken.row, { providerMessageId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return this.fail(taken.row, redactor.redact(message));
      } finally {
        redactor.clear();
      }
    } catch (error) {
      // The key is already destroyed, so the request can never be answered
      // again: record it as failed rather than leaving it stuck in
      // `executing`. Only a pre-decryption error is logged in full — after
      // that point nothing but the error name may leave this method.
      if (secretBytes) {
        console.error('[agentHumanRequest] secret request %s failed: %s', row.id, errorName(error));
      } else {
        console.error('[agentHumanRequest] secret request %s failed:', row.id, error);
      }
      return this.fail(taken.row, 'Secure input could not be processed.');
    } finally {
      wipe(secretBytes);
    }
  };

  private execute = async (row: AgentHumanRequestRow, extra: { edited: boolean }) => {
    const action = row.action;
    try {
      const { providerMessageId } = await this.options.sender(action.accountId, {
        subject: action.subject,
        text: action.text,
        threadKey: action.threadKey,
        to: action.to,
      });
      return this.complete(row, { edited: extra.edited || undefined, providerMessageId });
    } catch (error) {
      return this.fail(row, error instanceof Error ? error.message : String(error), extra);
    }
  };

  private complete = async (
    row: AgentHumanRequestRow,
    result: { edited?: boolean; providerMessageId: string },
  ) => {
    const done = await this.model.claim(row.id, ['executing'], { result, status: 'completed' });
    const item = toAgentHumanRequestItem(done ?? row);
    await this.notify(item);
    return item;
  };

  private fail = async (row: AgentHumanRequestRow, error: string, extra?: { edited: boolean }) => {
    const failed = await this.model.claim(row.id, ['executing'], {
      result: { edited: extra?.edited || undefined, error: error.slice(0, 500) },
      status: 'failed',
    });
    const item = toAgentHumanRequestItem(failed ?? row);
    await this.notify(item);
    return item;
  };

  // ------------------------------------------------------------------ helpers

  /**
   * Tell the agent about one outcome, durably. The attempt is claimed on the
   * row first, so concurrent deliveries of the same outcome collapse into one,
   * and only a wake that returned is marked delivered. A failed wake leaves
   * the row undelivered for {@link redeliverOutcomes}; it never turns the
   * already-correct action result into an error.
   */
  private notify = async (item: AgentHumanRequestItem, staleMs = 0) => {
    if (!this.options.notifier) return;

    // Everything here, the claim included, runs after the action result is
    // persisted: a failure is a delivery failure for redelivery to pick up,
    // never an error on the decision that already succeeded.
    try {
      const claimed = await this.model.claimNotification(item.id, new Date(this.now()), staleMs);
      if (!claimed?.notifyClaimId) return;

      await this.options.notifier.notify(toAgentHumanRequestItem(claimed));
      await this.model.markNotified(item.id, claimed.notifyClaimId, new Date(this.now()));
    } catch (error) {
      console.error(
        '[agentHumanRequest] waking the agent failed for %s, will retry:',
        item.id,
        error,
      );
    }
  };

  /**
   * Retry outcomes a previous wake failed to deliver. Lazy, like expiry: it
   * runs on the owner's reads (clients poll the card list), so a lost wake is
   * recovered without a scheduler and without touching the action result.
   */
  private redeliverOutcomes = async () => {
    if (!this.options.notifier) return;

    // Best effort on a read path: a redelivery problem must not fail the read.
    try {
      const ids = await this.model.listUndelivered(new Date(this.now()), NOTIFY_REDELIVER_AFTER_MS);
      for (const id of ids) {
        const row = await this.model.findById(id);
        if (row) await this.notify(toAgentHumanRequestItem(row), NOTIFY_REDELIVER_AFTER_MS);
      }
    } catch (error) {
      console.error('[agentHumanRequest] outcome redelivery failed:', error);
    }
  };

  private requireRow = async (id: string) => {
    const row = await this.model.findById(id);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
    return row;
  };

  /** A row that can still be answered: expire it first if its deadline passed. */
  private requireOpenRow = async (id: string) => {
    const row = await this.requireRow(id);
    if (row.status === 'pending' && row.expiresAt.getTime() < this.now()) {
      await this.model.expireDue(new Date(this.now()));
      throw conflict('This request has expired.');
    }
    return row;
  };

  private originColumns = (origin: AgentHumanRequestOrigin) => ({
    agentId: origin.agentId,
    operationId: origin.operationId ?? null,
    toolCallId: origin.toolCallId ?? null,
    topicId: origin.topicId ?? null,
  });

  private toAction = (input: RequestActionInput): AgentSendMessageAction => {
    const to = input.to?.trim();
    const text = input.text ?? '';
    if (!to) throw badRequest('A recipient is required.');
    if (!text.trim()) throw badRequest('The message text is empty.');
    if (text.length > MAX_TEXT_CHARS) throw badRequest('The message text is too long.');

    return {
      accountId: input.accountId,
      channel: input.channel,
      from: input.from,
      ...(input.subject ? { subject: input.subject } : {}),
      text,
      ...(input.threadKey ? { threadKey: input.threadKey } : {}),
      to,
      type: 'send_message',
    };
  };

  /** Returns the same object when nothing changed, a new action otherwise. */
  private applyEdits = (
    action: AgentHumanRequestAction,
    edits: AgentSendMessageEdits | undefined,
  ): AgentHumanRequestAction => {
    if (!edits) return action;

    const next = this.toAction({
      ...action,
      subject: edits.subject ?? action.subject,
      text: edits.text ?? action.text,
      to: edits.to ?? action.to,
    });
    // A new recipient is a new conversation: drop the thread it no longer belongs to.
    if (next.to !== action.to) delete next.threadKey;

    const same =
      next.to === action.to &&
      next.text === action.text &&
      (next.subject ?? '') === (action.subject ?? '') &&
      next.threadKey === action.threadKey;

    return same ? action : next;
  };
}
