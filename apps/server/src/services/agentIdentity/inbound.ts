import type { AgentAccountInboundMessage, AgentAccountInboundRequest } from '@lobechat/types';

import type { AgentAccountView } from '@/database/models/agentAccount';
import { AgentAccountModel } from '@/database/models/agentAccount';
import { AgentInboxModel } from '@/database/models/agentInbox';
import type { AgentInboxMessageItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { AgentInboxService } from './inbox';
import { AgentAccountService } from './index';
import { createDefaultAgentAccountRegistry } from './providers';
import { createAgentInboundWaker } from './waker';

/**
 * What the agent should do about a delivery that just landed.
 *
 * Injected rather than imported so the inbound route can be exercised without
 * standing up the whole run pipeline: production wires {@link
 * createAgentInboundWaker}, tests wire a recorder. The contract is deliberately
 * tiny — "a message arrived for this agent's account; do whatever waking means"
 * — so the waker can grow (share gating, budget, quiet hours) without the
 * webhook knowing.
 */
export interface AgentInboundWakeInput {
  account: AgentAccountView;
  message: AgentInboxMessageItem;
}

export interface AgentInboundWakeResult {
  /** Human-auditable reason the waker recorded (e.g. `started`, `no-agent`). */
  reason: string;
  /** Whether a run was actually started. */
  started: boolean;
  /** The topic the run landed in, so later mail on the same thread can join it. */
  topicId?: string;
}

export interface AgentInboundWaker {
  wake: (input: AgentInboundWakeInput) => Promise<AgentInboundWakeResult>;
}

/** The decision the webhook route turns into an HTTP status. */
export type AgentInboundResult =
  | {
      accountId: string;
      created: boolean;
      messageId: string;
      outcome: 'delivered';
      /**
       * 503 when the message is stored but its wake failed transiently: the
       * replay claim is released so the provider's retry wakes it then.
       */
      status: 200 | 503;
      wake: AgentInboundWakeResult;
    }
  | { accountId?: string; outcome: 'ignored'; status: 200 }
  | { accountId?: string; outcome: 'rejected'; status: 401 }
  | { outcome: 'unknown-account' | 'unroutable'; status: 404 };

export interface AgentInboundServiceOptions {
  /** The account service that owns signature verification. */
  accountService: AgentAccountService;
  /** Defaults to a no-op waker that reports `not-configured`. */
  waker?: AgentInboundWaker;
}

/**
 * Wake budget. Every delivery is still recorded — the limit only decides
 * whether it may start a run. Without it, anyone who knows the address can
 * start unbounded runs on the owner's account (and spend) just by mailing it.
 * Counted from the inbox itself, so the limit holds across instances with no
 * extra store.
 */
export const INBOUND_WAKE_LIMITS = {
  /** Deliveries per account in {@link windowMs} that may wake the agent. */
  perAccount: 30,
  /** Deliveries per (account, sender) in {@link windowMs} that may wake the agent. */
  perSender: 5,
  windowMs: 60 * 60 * 1000,
} as const;

/**
 * Wake outcomes worth a provider retry: the run pipeline failed, not a
 * deliberate decision (rate limit, missing agent, no waker configured).
 */
const RETRYABLE_WAKE_REASONS = new Set(['start-failed', 'wake-failed']);

const NOOP_WAKER: AgentInboundWaker = {
  wake: async () => ({ reason: 'waker-not-configured', started: false }),
};

/**
 * The inbound edge: one provider webhook delivery becomes one inbox message and
 * (optionally) one agent wake.
 *
 * It composes the three pieces that must stay separate:
 *
 * 1. **Verify** — {@link AgentAccountService.handleInbound} routes by an
 *    untrusted identifier and verifies the signature; only a `delivered`
 *    outcome is trusted.
 * 2. **Persist** — the normalized message is recorded as a first-class inbox
 *    row. `(accountId, providerMessageId)` is unique, so a provider retry
 *    returns the same message with `created: false` instead of duplicating it
 *    or waking the agent twice.
 * 3. **Wake** — a genuinely new delivery wakes the agent through the injected
 *    waker, within {@link INBOUND_WAKE_LIMITS}. A duplicate of a message that
 *    was already woken never reaches this step; a wake that failed transiently
 *    answers 503 and releases the replay claim, so the provider's retry wakes
 *    the still-unread message then.
 */
export class AgentInboundService {
  private readonly db: LobeChatDatabase;
  private readonly options: AgentInboundServiceOptions;

  constructor(db: LobeChatDatabase, options: AgentInboundServiceOptions) {
    this.db = db;
    this.options = options;
  }

  handle = async (
    provider: string,
    request: AgentAccountInboundRequest,
  ): Promise<AgentInboundResult> => {
    // A webhook URL for a provider this deployment never configured is a 404,
    // not the registry's thrown error surfacing as a 500.
    if (!this.options.accountService.hasProvider(provider)) {
      return { outcome: 'unroutable', status: 404 };
    }

    const decision = await this.options.accountService.handleInbound(provider, request);

    switch (decision.outcome) {
      case 'rejected': {
        return { accountId: decision.accountId, outcome: 'rejected', status: 401 };
      }
      case 'ignored': {
        return { accountId: decision.accountId, outcome: 'ignored', status: 200 };
      }
      case 'unknown-account':
      case 'unroutable': {
        return { outcome: decision.outcome, status: 404 };
      }
      default: {
        const result = await this.deliver(decision.accountId, decision.message);
        // Stored but not woken for a transient reason: forget the replay claim
        // so the provider's retry is processed and wakes the agent then.
        if (result.status === 503) {
          await this.options.accountService.releaseInbound(provider, decision.eventId);
        }
        return result;
      }
    }
  };

  /**
   * Persist a verified message and, if it is new, wake the agent.
   *
   * The account row is read through the *owner's* scope, so a message can only
   * ever land in the inbox of the user who owns the account — the webhook has
   * no caller identity to borrow.
   */
  private deliver = async (
    accountId: string,
    message: AgentAccountInboundMessage,
  ): Promise<AgentInboundResult> => {
    const account = await this.loadAccount(accountId);
    if (!account) return { outcome: 'unknown-account', status: 404 };

    const inbox = new AgentInboxService(this.db, account.userId, account.workspaceId ?? undefined);

    const { created, message: row } = await inbox.record({
      accountId,
      agentId: account.agentId,
      from: message.from,
      kind: account.kind,
      metadata: {},
      provider: account.provider,
      providerMessageId: message.providerMessageId,
      receivedAt: message.receivedAt,
      subject: message.subject ?? null,
      text: message.text,
      threadKey: message.threadKey ?? null,
      to: message.to,
    });

    // Idempotent ack: the provider retried a delivery we already handled, so
    // there is nothing new to wake the agent about. A stored row that is still
    // unread was never woken (a started wake marks it read) — that is the retry
    // of a failed wake, so it gets its wake now instead.
    if (!created && row.readAt) {
      return {
        accountId,
        created: false,
        messageId: row.id,
        outcome: 'delivered',
        status: 200,
        wake: { reason: 'duplicate-delivery', started: false },
      };
    }

    const wake = (await this.overWakeBudget(accountId, row.from))
      ? { reason: 'rate-limited', started: false }
      : await this.wake(account, row);

    return {
      accountId,
      created,
      messageId: row.id,
      outcome: 'delivered',
      status: RETRYABLE_WAKE_REASONS.has(wake.reason) ? 503 : 200,
      wake,
    };
  };

  /**
   * Whether this account (or this sender on it) already used up its wake
   * budget. The just-recorded row counts, so the limit is the number of
   * deliveries that may wake per window.
   */
  private overWakeBudget = async (accountId: string, from: string): Promise<boolean> => {
    const since = new Date(Date.now() - INBOUND_WAKE_LIMITS.windowMs);
    const [fromSender, total] = await Promise.all([
      AgentInboxModel.countRecent(this.db, { accountId, from, since }),
      AgentInboxModel.countRecent(this.db, { accountId, since }),
    ]);

    return fromSender > INBOUND_WAKE_LIMITS.perSender || total > INBOUND_WAKE_LIMITS.perAccount;
  };

  /**
   * One wake attempt. A thrown waker becomes the fixed `wake-failed` reason,
   * which {@link deliver} answers with a retryable status; the stored row stays
   * unread, so the provider's retry wakes it instead of reading as a duplicate.
   */
  private wake = async (
    account: AgentAccountView,
    message: AgentInboxMessageItem,
  ): Promise<AgentInboundWakeResult> => {
    const waker = this.options.waker ?? NOOP_WAKER;
    try {
      return await waker.wake({ account, message });
    } catch (error) {
      // The reason travels back to the provider in the webhook response, so it
      // stays a fixed code; the detail goes to the server log only.
      console.error('[agentInbound] wake failed for account %s:', account.id, error);
      return { reason: 'wake-failed', started: false };
    }
  };

  /** Read one account by id, unscoped (the webhook has no user to scope by). */
  private loadAccount = (accountId: string): Promise<AgentAccountView | undefined> =>
    AgentAccountModel.findByIdUnscoped(this.db, accountId);
}

/**
 * Assemble the inbound edge the way the webhook route runs it: the deployment's
 * real provider registry (so an unconfigured deployment answers 404 instead of
 * verifying nothing), a real KeyVaults gatekeeper (so signatures over an
 * account's stored secret can be verified), and the production waker.
 */
export const createAgentInboundService = async (
  db: LobeChatDatabase,
): Promise<AgentInboundService> => {
  const accountService = new AgentAccountService(db, '', {
    gateKeeper: await KeyVaultsGateKeeper.initWithEnvKey(),
    registry: createDefaultAgentAccountRegistry(),
  });

  return new AgentInboundService(db, {
    accountService,
    waker: createAgentInboundWaker(db),
  });
};
