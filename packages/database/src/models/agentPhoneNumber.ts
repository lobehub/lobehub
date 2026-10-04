import type { MessagingCampaignStatus } from '@lobechat/types';
import { and, asc, eq, gte, isNull, lte, ne, sql } from 'drizzle-orm';

import type {
  AgentNumberChargeItem,
  AgentPhoneNumberItem,
  NewAgentNumberCharge,
  NewAgentPhoneNumber,
} from '../schemas';
import { agentNumberCharges, agentPhoneNumbers } from '../schemas';
import type { LobeChatDatabase } from '../type';

/** Who a number is being handed to. */
export interface AgentPhoneNumberOwner {
  agentId: string;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Dedicated number inventory.
 *
 * Platform-scoped on purpose: the warm pool and the quarantine belong to no
 * user, and every caller is the number service acting for the platform. The
 * user-facing reads go through `agent_accounts`, which is ownership-scoped.
 */
export class AgentPhoneNumberModel {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  insert = async (row: NewAgentPhoneNumber): Promise<AgentPhoneNumberItem> => {
    const [created] = await this.db.insert(agentPhoneNumbers).values(row).returning();
    return created;
  };

  findById = async (id: string): Promise<AgentPhoneNumberItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(agentPhoneNumbers)
      .where(eq(agentPhoneNumbers.id, id))
      .limit(1);
    return row;
  };

  /** The live (not yet released) inventory row for a number, if any. */
  findLiveByNumber = async (
    provider: string,
    phoneNumber: string,
  ): Promise<AgentPhoneNumberItem | undefined> => {
    const [row] = await this.db
      .select()
      .from(agentPhoneNumbers)
      .where(
        and(
          eq(agentPhoneNumbers.provider, provider),
          eq(agentPhoneNumbers.phoneNumber, phoneNumber),
          ne(agentPhoneNumbers.status, 'released'),
        ),
      )
      .limit(1);
    return row;
  };

  countPooled = async (provider: string, areaCode?: string): Promise<number> => {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentPhoneNumbers)
      .where(
        and(
          eq(agentPhoneNumbers.provider, provider),
          eq(agentPhoneNumbers.status, 'pooled'),
          areaCode ? eq(agentPhoneNumbers.areaCode, areaCode) : undefined,
        ),
      );
    return row?.count ?? 0;
  };

  /**
   * Hand one pooled number to an agent in a single statement.
   *
   * `FOR UPDATE SKIP LOCKED` lets concurrent purchases each take a different
   * number instead of racing for the oldest one; a caller that gets nothing
   * back falls through to buying a number on demand.
   */
  claimPooled = async (
    provider: string,
    owner: AgentPhoneNumberOwner,
    areaCode?: string,
  ): Promise<AgentPhoneNumberItem | undefined> => {
    const candidate = this.db
      .select({ id: agentPhoneNumbers.id })
      .from(agentPhoneNumbers)
      .where(
        and(
          eq(agentPhoneNumbers.provider, provider),
          eq(agentPhoneNumbers.status, 'pooled'),
          areaCode ? eq(agentPhoneNumbers.areaCode, areaCode) : undefined,
        ),
      )
      .orderBy(asc(agentPhoneNumbers.purchasedAt))
      .limit(1)
      .for('update', { skipLocked: true });

    const [row] = await this.db
      .update(agentPhoneNumbers)
      .set({
        agentId: owner.agentId,
        assignedAt: new Date(),
        status: 'assigned',
        updatedAt: new Date(),
        userId: owner.userId,
        workspaceId: owner.workspaceId ?? null,
      })
      .where(sql`${agentPhoneNumbers.id} = (${candidate})`)
      .returning();

    return row;
  };

  attachAccount = async (id: string, accountId: string): Promise<void> => {
    await this.db
      .update(agentPhoneNumbers)
      .set({ accountId, updatedAt: new Date() })
      .where(eq(agentPhoneNumbers.id, id));
  };

  /** Undo a claim whose account row could not be written: the number never served anyone. */
  returnToPool = async (id: string): Promise<void> => {
    await this.db
      .update(agentPhoneNumbers)
      .set({
        accountId: null,
        agentId: null,
        assignedAt: null,
        status: 'pooled',
        updatedAt: new Date(),
        userId: null,
        workspaceId: null,
      })
      .where(and(eq(agentPhoneNumbers.id, id), eq(agentPhoneNumbers.status, 'assigned')));
  };

  /**
   * Take an assigned number out of service. The owner columns are kept: they
   * are the audit trail of who last held it, and nothing routes on them while
   * the number is quarantined.
   */
  quarantine = async (id: string, until: Date): Promise<AgentPhoneNumberItem | undefined> => {
    const [row] = await this.db
      .update(agentPhoneNumbers)
      .set({
        accountId: null,
        quarantineUntil: until,
        quarantinedAt: new Date(),
        status: 'quarantined',
        updatedAt: new Date(),
      })
      .where(and(eq(agentPhoneNumbers.id, id), eq(agentPhoneNumbers.status, 'assigned')))
      .returning();
    return row;
  };

  setMetadata = async (id: string, metadata: Record<string, unknown>): Promise<void> => {
    await this.db
      .update(agentPhoneNumbers)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(agentPhoneNumbers.id, id));
  };

  listQuarantineExpired = async (now: Date, limit = 50): Promise<AgentPhoneNumberItem[]> =>
    this.db
      .select()
      .from(agentPhoneNumbers)
      .where(
        and(
          eq(agentPhoneNumbers.status, 'quarantined'),
          lte(agentPhoneNumbers.quarantineUntil, now),
        ),
      )
      .orderBy(asc(agentPhoneNumbers.quarantineUntil))
      .limit(limit);

  markReleased = async (id: string): Promise<void> => {
    await this.db
      .update(agentPhoneNumbers)
      .set({ releasedAt: new Date(), status: 'released', updatedAt: new Date() })
      .where(eq(agentPhoneNumbers.id, id));
  };

  updateCampaign = async (
    id: string,
    campaign: { campaignId?: string | null; status: MessagingCampaignStatus },
  ): Promise<void> => {
    await this.db
      .update(agentPhoneNumbers)
      .set({
        campaignId: campaign.campaignId ?? null,
        campaignStatus: campaign.status,
        updatedAt: new Date(),
      })
      .where(eq(agentPhoneNumbers.id, id));
  };

  listByStatus = async (
    status: AgentPhoneNumberItem['status'],
    provider?: string,
  ): Promise<AgentPhoneNumberItem[]> =>
    this.db
      .select()
      .from(agentPhoneNumbers)
      .where(
        and(
          eq(agentPhoneNumbers.status, status),
          provider ? eq(agentPhoneNumbers.provider, provider) : undefined,
        ),
      )
      .orderBy(asc(agentPhoneNumbers.purchasedAt));

  /** Assigned numbers that never got an account row (crash between claim and create). */
  listOrphanedAssignments = async (olderThan: Date): Promise<AgentPhoneNumberItem[]> =>
    this.db
      .select()
      .from(agentPhoneNumbers)
      .where(
        and(
          eq(agentPhoneNumbers.status, 'assigned'),
          isNull(agentPhoneNumbers.accountId),
          lte(agentPhoneNumbers.assignedAt, olderThan),
        ),
      );
}

/**
 * The per-agent ledger of what dedicated numbers cost. Writes are idempotent
 * on `external_id`; reads answer the cap check.
 */
export class AgentNumberChargeModel {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  /** Record a charge once. `created: false` means this external id was already billed. */
  record = async (
    row: NewAgentNumberCharge,
  ): Promise<{ charge?: AgentNumberChargeItem; created: boolean }> => {
    const [charge] = await this.db
      .insert(agentNumberCharges)
      .values(row)
      .onConflictDoNothing({ target: agentNumberCharges.externalId })
      .returning();
    return { charge, created: !!charge };
  };

  /** USD billed to an agent since a point in time. */
  sumForAgentSince = async (agentId: string, since: Date): Promise<number> => {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${agentNumberCharges.amountUsd}), 0)` })
      .from(agentNumberCharges)
      .where(
        and(eq(agentNumberCharges.agentId, agentId), gte(agentNumberCharges.occurredAt, since)),
      );
    return Number(row?.total ?? 0);
  };

  /** Outbound SMS segments sent by an agent since a point in time. */
  outboundSegmentsSince = async (agentId: string, since: Date): Promise<number> => {
    const [row] = await this.db
      .select({ total: sql<string>`coalesce(sum(${agentNumberCharges.quantity}), 0)` })
      .from(agentNumberCharges)
      .where(
        and(
          eq(agentNumberCharges.agentId, agentId),
          eq(agentNumberCharges.type, 'sms_segment'),
          sql`${agentNumberCharges.metadata}->>'direction' = 'outbound'`,
          gte(agentNumberCharges.occurredAt, since),
        ),
      );
    return Number(row?.total ?? 0);
  };

  listForAgent = async (agentId: string): Promise<AgentNumberChargeItem[]> =>
    this.db
      .select()
      .from(agentNumberCharges)
      .where(eq(agentNumberCharges.agentId, agentId))
      .orderBy(asc(agentNumberCharges.occurredAt));
}
