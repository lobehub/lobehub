import type { AgentMailAddress, AgentMailAttachment, AgentMailDirection } from '@lobechat/types';
import { and, eq, gte, or, sql } from 'drizzle-orm';

import type { AgentMailItem, NewAgentMail } from '../schemas';
import { agentMails } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { agentUsableBy } from '../utils/agent-access';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

export interface RecordAgentMailParams {
  accountId: string;
  agentId: string;
  attachments?: AgentMailAttachment[];
  cc?: AgentMailAddress[];
  codes?: string[];
  deliveredAt: Date;
  direction: AgentMailDirection;
  fromAddress: string;
  fromName?: string | null;
  inReplyTo?: string | null;
  messageId?: string | null;
  provider: string;
  providerMessageId: string;
  references?: string[];
  replyTo?: AgentMailAddress[];
  signalId?: string | null;
  subject?: string | null;
  text: string;
  threadKey?: string | null;
  to?: AgentMailAddress[];
}

export interface RecordAgentMailResult {
  /** False when this provider message was already recorded. */
  created: boolean;
  mail: AgentMailItem;
}

/** Lowercased and trimmed, the way `from_address` is stored and compared. */
export const normalizeMailAddress = (address: string): string => address.trim().toLowerCase();

/**
 * Mail an agent's mail accounts received or sent.
 *
 * Inbound mail is recorded by the inbound edge (unscoped, before any user is
 * known); sent mail by the account tool after the provider accepted it. Reads
 * are scoped like the inbox: workspace AND the owning agent's visibility,
 * because mail carries whatever outsiders sent the agent, codes included.
 */
export class AgentMailModel {
  private db: LobeChatDatabase;
  private userId: string;
  private workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
  }

  private ownership = () => {
    const ctx = { userId: this.userId, workspaceId: this.workspaceId };

    return and(
      buildWorkspaceWhere(ctx, agentMails),
      agentUsableBy(this.db, agentMails.agentId, ctx),
    )!;
  };

  /**
   * Record one message. Idempotent on `(account_id, provider_message_id)`: the
   * same provider message recorded again returns the stored row.
   */
  static record = async (
    db: LobeChatDatabase,
    params: RecordAgentMailParams,
    scope: { userId: string; workspaceId?: string },
  ): Promise<RecordAgentMailResult> => {
    const values = buildWorkspacePayload(scope, {
      accountId: params.accountId,
      agentId: params.agentId,
      attachments: params.attachments ?? [],
      cc: params.cc ?? [],
      codes: params.codes ?? [],
      deliveredAt: params.deliveredAt,
      direction: params.direction,
      fromAddress: normalizeMailAddress(params.fromAddress),
      fromName: params.fromName ?? null,
      inReplyTo: params.inReplyTo ?? null,
      messageId: params.messageId ?? null,
      provider: params.provider,
      providerMessageId: params.providerMessageId,
      references: params.references ?? [],
      replyTo: params.replyTo ?? [],
      signalId: params.signalId ?? null,
      subject: params.subject ?? null,
      text: params.text,
      threadKey: params.threadKey ?? null,
      to: params.to ?? [],
    } as NewAgentMail);

    const [inserted] = await db
      .insert(agentMails)
      .values(values)
      .onConflictDoNothing({ target: [agentMails.accountId, agentMails.providerMessageId] })
      .returning();
    if (inserted) return { created: true, mail: inserted };

    const [existing] = await db
      .select()
      .from(agentMails)
      .where(
        and(
          eq(agentMails.accountId, params.accountId),
          eq(agentMails.providerMessageId, params.providerMessageId),
        ),
      )
      .limit(1);

    return { created: false, mail: existing };
  };

  /**
   * The newest inbound mail from someone other than `recipient`, delivered at or
   * after `since`, whose body contains any of `candidates` once case and
   * separators are stripped from both sides — the check for links, tokens and
   * credentials an unattended reply must not relay. Sent mail never counts: the
   * agent's own words are not another sender's secret.
   *
   * `candidates` must already be normalised the same way (lowercased, non
   * alphanumerics removed).
   */
  findTextFromOtherSender = async (params: {
    agentId: string;
    candidates: string[];
    recipient: string;
    since: Date;
  }): Promise<{ from: string } | undefined> => {
    if (params.candidates.length === 0) return undefined;

    const [row] = await this.db
      .select({ from: agentMails.fromAddress })
      .from(agentMails)
      .where(
        and(
          this.ownership(),
          eq(agentMails.agentId, params.agentId),
          eq(agentMails.direction, 'inbound'),
          gte(agentMails.deliveredAt, params.since),
          sql`${agentMails.fromAddress} <> ${normalizeMailAddress(params.recipient)}`,
          or(
            ...params.candidates.map(
              (candidate) =>
                sql`strpos(lower(regexp_replace(${agentMails.text}, '[^0-9A-Za-z]', '', 'g')), ${candidate}) > 0`,
            ),
          ),
        ),
      )
      .orderBy(sql`${agentMails.deliveredAt} desc`)
      .limit(1);

    return row;
  };

  /**
   * Every distinct code extracted from inbound mail sent by someone other than
   * `recipient` at or after `since`, with its sender. The whole window is read in
   * one query (codes only), so a flood of later mail cannot hide one.
   */
  listCodesFromOtherSenders = async (params: {
    agentId: string;
    recipient: string;
    since: Date;
  }): Promise<{ code: string; from: string }[]> => {
    const code = sql<string>`jsonb_array_elements_text(${agentMails.codes})`;

    return this.db
      .selectDistinct({ code, from: agentMails.fromAddress })
      .from(agentMails)
      .where(
        and(
          this.ownership(),
          eq(agentMails.agentId, params.agentId),
          eq(agentMails.direction, 'inbound'),
          gte(agentMails.deliveredAt, params.since),
          sql`${agentMails.fromAddress} <> ${normalizeMailAddress(params.recipient)}`,
        ),
      );
  };

  /** One account's thread, oldest first — both what arrived and what the agent sent. */
  listThread = async (params: { accountId: string; threadKey: string }): Promise<AgentMailItem[]> =>
    this.db
      .select()
      .from(agentMails)
      .where(
        and(
          this.ownership(),
          eq(agentMails.accountId, params.accountId),
          eq(agentMails.threadKey, params.threadKey),
        ),
      )
      .orderBy(agentMails.deliveredAt);
}
