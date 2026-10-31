import type {
  AgentAccountInboundMessage,
  AgentInboxSummary,
  AgentMailAddress,
} from '@lobechat/types';

import type { AgentInboxEntry } from '@/database/models/agentInbox';
import { AgentInboxModel } from '@/database/models/agentInbox';
import { AgentMailModel } from '@/database/models/agentMail';
import type { LobeChatDatabase } from '@/database/type';

/**
 * Pull the verification codes out of an inbound body.
 *
 * Deliberately dumb: a standalone run of 4–8 digits. It matches the shape of
 * an emailed/texted OTP and of almost nothing else a human writes in prose,
 * which is exactly the contract the `wait` primitive needs — "hand me the code
 * that just arrived" without asking the model to re-read the body. Anything
 * more clever (context windows around the word "code", locale-aware parsing)
 * would trade a guessable miss for an unexplainable false positive.
 */
export const extractVerificationCodes = (text: string): string[] => {
  const matches = text.match(/(?<!\d)\d{4,8}(?!\d)/g);
  if (!matches) return [];

  // A code is usually the only one; keep first-seen order, drop repeats.
  return [...new Set(matches)];
};

/** Characters of body the inbox list shows; the full body stays on the mail. */
const PREVIEW_CHARS = 200;

const toPreview = (text: string): string | null => {
  const flat = text.replaceAll(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
};

/** The inbound mail an account received, and the account it arrived at. */
export interface RecordInboundMailParams {
  account: { agentId: string; id: string; identifier: string; provider: string };
  message: AgentAccountInboundMessage;
  /** The signal the mail was parsed from, when it came in through one. */
  signalId?: string | null;
}

export interface RecordInboundMailResult {
  /** False when the mail was already in the inbox (a provider retry). */
  created: boolean;
  entry: AgentInboxEntry;
}

/**
 * The agent's inbox and mail, as the runtime and the account tool read them.
 *
 * A thin, credential-free layer over {@link AgentInboxModel} and
 * {@link AgentMailModel}: it owns code extraction and turning a mail into an
 * inbox item on ingest, recording sent mail, and the agent-scoped summary the
 * context injector consumes. It never verifies signatures — that is the
 * account service's job — and never wakes the agent — that is the inbound
 * service's.
 */
export class AgentInboxService {
  private readonly db: LobeChatDatabase;
  private readonly mail: AgentMailModel;
  private readonly model: AgentInboxModel;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.mail = new AgentMailModel(db, userId, workspaceId);
    this.model = new AgentInboxModel(db, userId, workspaceId);
  }

  private get scope() {
    return { userId: this.userId, workspaceId: this.workspaceId };
  }

  list = (params?: Parameters<AgentInboxModel['list']>[0]) => this.model.list(params);

  unreadCount = (agentId: string) => this.model.unreadCount(agentId);

  markRead = (ids: string[]) => this.model.markRead(ids);

  markWaitConsumed = (id: string, operationId: string) =>
    this.model.markWaitConsumed(id, operationId);

  markAllRead = (agentId: string) => this.model.markAllRead(agentId);

  listSince = (params: Parameters<AgentInboxModel['listSince']>[0]) => this.model.listSince(params);

  findTextFromOtherSender = (params: Parameters<AgentMailModel['findTextFromOtherSender']>[0]) =>
    this.mail.findTextFromOtherSender(params);

  listCodesFromOtherSenders = (
    params: Parameters<AgentMailModel['listCodesFromOtherSenders']>[0],
  ) => this.mail.listCodesFromOtherSenders(params);

  countForAccount = (accountId: string) => this.model.countForAccount(accountId);

  /**
   * Ingest one inbound mail: record it as an `agent_mails` row (codes extracted
   * here), then put it in the inbox. Both steps are idempotent, so a provider
   * retry returns the existing item with `created: false`.
   */
  recordInboundMail = async ({
    account,
    message,
    signalId,
  }: RecordInboundMailParams): Promise<RecordInboundMailResult> => {
    const detail = message.mail;
    const { mail } = await AgentMailModel.record(
      this.db,
      {
        accountId: account.id,
        agentId: account.agentId,
        attachments: detail?.attachments,
        cc: detail?.cc,
        codes: extractVerificationCodes(message.text),
        deliveredAt: message.receivedAt,
        direction: 'inbound',
        fromAddress: message.from,
        fromName: detail?.fromName,
        inReplyTo: detail?.inReplyTo,
        messageId: detail?.messageId,
        provider: account.provider,
        providerMessageId: message.providerMessageId,
        references: detail?.references,
        replyTo: detail?.replyTo,
        signalId,
        subject: message.subject,
        text: message.text,
        threadKey: message.threadKey,
        to: detail?.to ?? [{ address: message.to }],
      },
      this.scope,
    );

    const { created, item } = await AgentInboxModel.deliver(
      this.db,
      {
        accountId: account.id,
        agentId: account.agentId,
        preview: toPreview(mail.text),
        receivedAt: mail.deliveredAt,
        sender: mail.fromAddress,
        sourceId: mail.id,
        sourceType: 'mail',
        threadKey: mail.threadKey,
        title: mail.subject,
      },
      this.scope,
    );

    const entry = await AgentInboxModel.findEntry(this.db, item.id);
    return { created, entry: entry! };
  };

  /**
   * Record mail the agent sent, once the provider accepted it, so its thread
   * reads whole from LobeHub's side. Sent mail is not an inbox item.
   */
  recordSentMail = (params: {
    account: { agentId: string; id: string; identifier: string; provider: string };
    inReplyTo?: string | null;
    providerMessageId: string;
    subject?: string | null;
    text: string;
    threadKey?: string | null;
    to: AgentMailAddress[];
  }) =>
    AgentMailModel.record(
      this.db,
      {
        accountId: params.account.id,
        agentId: params.account.agentId,
        deliveredAt: new Date(),
        direction: 'outbound',
        fromAddress: params.account.identifier,
        inReplyTo: params.inReplyTo,
        provider: params.account.provider,
        providerMessageId: params.providerMessageId,
        subject: params.subject,
        text: params.text,
        threadKey: params.threadKey,
        to: params.to,
      },
      this.scope,
    );

  /**
   * The first-class view the model gets: how much is unread — and nothing
   * else. Message content is attacker-controlled, so it reaches the model only
   * through the account tool's `readInbox`, fenced as untrusted input.
   */
  static async summary(db: LobeChatDatabase, agentId: string): Promise<AgentInboxSummary> {
    return { unreadCount: await AgentInboxModel.unreadCountForAgent(db, agentId) };
  }
}
