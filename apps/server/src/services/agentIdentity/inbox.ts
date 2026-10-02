import type { AgentInboxMessage, AgentInboxSummary } from '@lobechat/types';

import type {
  RecordInboxMessageParams,
  RecordInboxMessageResult,
} from '@/database/models/agentInbox';
import { AgentInboxModel } from '@/database/models/agentInbox';
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

/**
 * The agent's inbox, as the runtime and the account tool read it.
 *
 * A thin, credential-free wrapper over {@link AgentInboxModel}: it owns code
 * extraction on ingest and the agent-scoped summary the context injector
 * consumes. It never verifies signatures — that is the account service's job —
 * and never wakes the agent — that is the inbound service's.
 */
export class AgentInboxService {
  private readonly db: LobeChatDatabase;
  private readonly model: AgentInboxModel;
  private readonly userId: string;
  private readonly workspaceId?: string;

  constructor(db: LobeChatDatabase, userId: string, workspaceId?: string) {
    this.db = db;
    this.userId = userId;
    this.workspaceId = workspaceId;
    this.model = new AgentInboxModel(db, userId, workspaceId);
  }

  list = (params?: {
    accountId?: string;
    agentId?: string;
    limit?: number;
    unreadOnly?: boolean;
  }) => this.model.list(params);

  unreadCount = (agentId: string) => this.model.unreadCount(agentId);

  markRead = (ids: string[]) => this.model.markRead(ids);

  markAllRead = (agentId: string) => this.model.markAllRead(agentId);

  listSince = (params: { accountId?: string; agentId: string; limit?: number; since: Date }) =>
    this.model.listSince(params);

  countForAccount = (accountId: string) => this.model.countForAccount(accountId);

  /**
   * Ingest one normalized inbound message. Codes are extracted here so the row
   * carries them; the model handles idempotency by provider message id.
   */
  record = (params: Omit<RecordInboxMessageParams, 'codes'>): Promise<RecordInboxMessageResult> =>
    AgentInboxModel.record(
      this.db,
      { ...params, codes: extractVerificationCodes(params.text) },
      { userId: this.userId, workspaceId: this.workspaceId },
    );

  /**
   * The first-class view the model gets: how much is unread and the newest few
   * messages, newest first. `limit` is small on purpose — this is context, not
   * an inbox browser.
   */
  static async summary(
    db: LobeChatDatabase,
    agentId: string,
    limit = 3,
  ): Promise<AgentInboxSummary & { latest: AgentInboxMessage[] }> {
    const [rows, unreadCount] = await Promise.all([
      AgentInboxModel.latestForAgent(db, agentId, limit),
      AgentInboxModel.unreadCountForAgent(db, agentId),
    ]);

    return {
      latest: rows.map((row) => ({
        accountId: row.accountId,
        agentId: row.agentId,
        codes: row.codes ?? [],
        createdAt: row.createdAt,
        from: row.from,
        id: row.id,
        kind: row.kind,
        readAt: row.readAt,
        receivedAt: row.receivedAt,
        subject: row.subject,
        text: row.text,
        threadKey: row.threadKey,
        to: row.to,
      })),
      unreadCount,
    };
  }
}
