import type { AgentMailAddress, AgentMailComposeMode } from '@lobechat/types';
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import type { AgentMailDraftItem, NewAgentMailDraft } from '../schemas';
import { agentMailDrafts } from '../schemas';
import type { LobeChatDatabase } from '../type';
import { agentUsableBy } from '../utils/agent-access';
import { buildWorkspacePayload, buildWorkspaceWhere } from '../utils/workspace';

/** A send that outlives this died with its worker; its draft may be sent again. */
export const DRAFT_SEND_LEASE_SECONDS = 2 * 60;

/** No send holds the draft: edits now would race a send that already read it. */
const sendLeaseFree = () =>
  or(
    isNull(agentMailDrafts.sendingAt),
    lt(agentMailDrafts.sendingAt, sql`now() - make_interval(secs => ${DRAFT_SEND_LEASE_SECONDS})`),
  );

export interface AgentMailDraftContent {
  bcc?: AgentMailAddress[];
  cc?: AgentMailAddress[];
  subject?: string | null;
  text?: string;
  to?: AgentMailAddress[];
}

export interface SaveAgentMailDraftParams extends AgentMailDraftContent {
  accountId: string;
  agentId: string;
  mode: AgentMailComposeMode;
  sourceMailId?: string | null;
}

/**
 * Drafts of the mail a person is writing from an agent's address. Scoped like
 * the mail itself: workspace AND the owning agent's visibility.
 */
export class AgentMailDraftModel {
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
      buildWorkspaceWhere(ctx, agentMailDrafts),
      agentUsableBy(this.db, agentMailDrafts.agentId, ctx),
    )!;
  };

  /**
   * Create a draft. Answering a mail the same way again resumes the draft that
   * already exists instead of opening a second one — unless that draft is being
   * sent, which returns `undefined`: the edit would be lost when the send
   * deletes it.
   */
  create = async (params: SaveAgentMailDraftParams): Promise<AgentMailDraftItem | undefined> => {
    const values = buildWorkspacePayload({ userId: this.userId, workspaceId: this.workspaceId }, {
      accountId: params.accountId,
      agentId: params.agentId,
      bcc: params.bcc ?? [],
      cc: params.cc ?? [],
      mode: params.mode,
      sourceMailId: params.sourceMailId ?? null,
      subject: params.subject ?? null,
      text: params.text ?? '',
      to: params.to ?? [],
    } as NewAgentMailDraft);

    // Only what the caller actually supplied overwrites the draft it resumes.
    // Omitted content means "answer this mail again", not "erase what I wrote
    // last time" — the insert above still fills the column defaults.
    const overwrite: Partial<NewAgentMailDraft> = { updatedAt: new Date() };
    if (params.bcc !== undefined) overwrite.bcc = values.bcc;
    if (params.cc !== undefined) overwrite.cc = values.cc;
    if (params.subject !== undefined) overwrite.subject = values.subject;
    if (params.text !== undefined) overwrite.text = values.text;
    if (params.to !== undefined) overwrite.to = values.to;

    const [inserted] = await this.db
      .insert(agentMailDrafts)
      .values(values)
      .onConflictDoUpdate({
        set: overwrite,
        setWhere: sendLeaseFree(),
        target: [agentMailDrafts.accountId, agentMailDrafts.sourceMailId, agentMailDrafts.mode],
        targetWhere: sql`${agentMailDrafts.sourceMailId} is not null`,
      })
      .returning();

    return inserted;
  };

  /** `undefined` when the draft is out of scope or being sent. */
  update = async (
    id: string,
    content: AgentMailDraftContent,
  ): Promise<AgentMailDraftItem | undefined> => {
    const [row] = await this.db
      .update(agentMailDrafts)
      .set({ ...content, updatedAt: new Date() })
      .where(and(eq(agentMailDrafts.id, id), sendLeaseFree(), this.ownership()))
      .returning();

    return row;
  };

  findById = async (id: string): Promise<AgentMailDraftItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(agentMailDrafts)
      .where(and(eq(agentMailDrafts.id, id), this.ownership()))
      .limit(1);

    return row;
  };

  /** Most recently edited first. */
  list = async (params: {
    accountId?: string;
    agentId: string;
    before?: { id: string; updatedAt: Date };
    limit?: number;
  }): Promise<AgentMailDraftItem[]> =>
    this.db
      .select()
      .from(agentMailDrafts)
      .where(
        and(
          this.ownership(),
          eq(agentMailDrafts.agentId, params.agentId),
          params.accountId ? eq(agentMailDrafts.accountId, params.accountId) : undefined,
          params.before
            ? or(
                lt(agentMailDrafts.updatedAt, params.before.updatedAt),
                and(
                  eq(agentMailDrafts.updatedAt, params.before.updatedAt),
                  lt(agentMailDrafts.id, params.before.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(agentMailDrafts.updatedAt), desc(agentMailDrafts.id))
      .limit(params.limit ?? 30);

  count = async (params: { accountId?: string; agentId: string }): Promise<number> => {
    const [row] = await this.db
      .select({ value: count() })
      .from(agentMailDrafts)
      .where(
        and(
          this.ownership(),
          eq(agentMailDrafts.agentId, params.agentId),
          params.accountId ? eq(agentMailDrafts.accountId, params.accountId) : undefined,
        ),
      );

    return row?.value ?? 0;
  };

  /** The agents owning these drafts, for the permission check before a write. */
  listAgentIds = async (ids: string[]): Promise<string[]> => {
    if (ids.length === 0) return [];

    const rows = await this.db
      .selectDistinct({ agentId: agentMailDrafts.agentId })
      .from(agentMailDrafts)
      .where(and(inArray(agentMailDrafts.id, ids), this.ownership()));

    return rows.map((row) => row.agentId);
  };

  delete = async (ids: string[]): Promise<number> => {
    if (ids.length === 0) return 0;

    const rows = await this.db
      .delete(agentMailDrafts)
      .where(and(inArray(agentMailDrafts.id, ids), this.ownership()))
      .returning({ id: agentMailDrafts.id });

    return rows.length;
  };

  /**
   * Take the right to send this draft. Atomic, so a double submit sends once;
   * a lease left by a worker that died expires.
   */
  claimForSend = async (id: string): Promise<AgentMailDraftItem | undefined> => {
    const [row] = await this.db
      .update(agentMailDrafts)
      .set({ sendingAt: sql`now()` })
      .where(and(eq(agentMailDrafts.id, id), sendLeaseFree(), this.ownership()))
      .returning();

    return row;
  };

  releaseSend = async (id: string): Promise<void> => {
    await this.db
      .update(agentMailDrafts)
      .set({ sendingAt: null })
      .where(and(eq(agentMailDrafts.id, id), this.ownership()));
  };
}
