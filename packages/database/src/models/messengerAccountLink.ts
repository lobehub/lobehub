import { and, eq, type SQL } from 'drizzle-orm';

import type { MessengerAccountLinkItem, NewMessengerAccountLink } from '../schemas';
import { messengerAccountLinks } from '../schemas';
import type { LobeChatDatabase } from '../type';

/**
 * Tenant id for global-token platforms (Telegram today, Discord later) —
 * they have one bot serving every chat, so there's no scoping. Per-tenant
 * platforms (Slack, future Feishu / MS Teams) pass the actual tenant id.
 */
const GLOBAL_TENANT_ID = '';

/**
 * Thrown by `upsertForPlatform` when the IM identity is already bound to a
 * different LobeHub user. Callers (e.g. the messenger router) should surface
 * a friendly 409 — never let the underlying DB unique-index error escape.
 */
export class MessengerAccountLinkConflictError extends Error {
  readonly code = 'MESSENGER_ACCOUNT_LINK_CONFLICT' as const;
  readonly existingUserId: string;

  constructor(existingUserId: string, message?: string) {
    super(message ?? 'IM identity is already linked to another LobeHub user');
    this.name = 'MessengerAccountLinkConflictError';
    this.existingUserId = existingUserId;
  }
}

/**
 * Thrown when the same LobeHub user already has a different IM identity bound
 * for the requested `(platform, tenant)` scope and must explicitly unlink
 * before switching accounts.
 */
export class MessengerAccountLinkRelinkRequiredError extends Error {
  readonly code = 'MESSENGER_ACCOUNT_LINK_RELINK_REQUIRED' as const;

  constructor(message?: string) {
    super(message ?? 'Existing messenger link must be unlinked before re-linking');
    this.name = 'MessengerAccountLinkRelinkRequiredError';
  }
}

export class MessengerAccountLinkModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  // --------------- User-scoped CRUD ---------------

  /**
   * Insert or update the user's link for `(platform, tenantId)`. Used by the
   * verify-im confirm flow — if the user re-asserts the same IM identity they
   * keep the same row, but switching to a different IM identity in the same
   * `(platform, tenant)` requires an explicit unlink first.
   *
   * For Telegram (and any global-bot platform), `tenantId` is omitted /
   * defaults to the empty string, which collapses the new 3-column index
   * back to the original `(user, platform)` semantic.
   *
   * Resolution order is `(platform, tenant, platformUserId)` first, then
   * `(user, platform, tenant)` — so we never let the
   * `messenger_account_links_platform_tenant_user_unique` constraint surface
   * as an opaque DB error when the IM identity is already owned by another
   * LobeHub user; we throw `MessengerAccountLinkConflictError` instead.
   *
   * Returns the resulting link row.
   */
  upsertForPlatform = async (
    params: Omit<NewMessengerAccountLink, 'userId' | 'id'>,
  ): Promise<MessengerAccountLinkItem> => {
    const tenantId = params.tenantId ?? GLOBAL_TENANT_ID;
    const now = new Date();

    // Try to claim the `(user, platform, tenant)` scope first. This prevents
    // concurrent verify-im confirmations from both observing "no row" and
    // then silently overwriting one another in a later update path.
    try {
      const [created] = await this.db
        .insert(messengerAccountLinks)
        .values({
          ...params,
          tenantId,
          updatedAt: now,
          userId: this.userId,
        })
        .onConflictDoNothing({
          target: [
            messengerAccountLinks.userId,
            messengerAccountLinks.platform,
            messengerAccountLinks.tenantId,
          ],
        })
        .returning();

      if (created) return created;
    } catch (error) {
      const pgError = error as { cause?: { code?: string; constraint?: string }; code?: string };
      const code = pgError.cause?.code ?? pgError.code;
      const constraint = pgError.cause?.constraint;

      if (
        code !== '23505' &&
        constraint !== 'messenger_account_links_platform_tenant_user_unique'
      ) {
        throw error;
      }
    }

    // Resolve by IM identity after the insert attempt. This catches both the
    // steady-state refresh path and races where another request/user inserted
    // before us.
    const byIdentity = await MessengerAccountLinkModel.findByPlatformUser(
      this.db,
      params.platform,
      params.platformUserId,
      tenantId,
    );

    if (byIdentity) {
      if (byIdentity.userId !== this.userId) {
        throw new MessengerAccountLinkConflictError(byIdentity.userId);
      }
      const [updated] = await this.db
        .update(messengerAccountLinks)
        .set({
          activeAgentId: params.activeAgentId ?? byIdentity.activeAgentId,
          platformUsername: params.platformUsername ?? null,
          updatedAt: now,
        })
        .where(eq(messengerAccountLinks.id, byIdentity.id))
        .returning();
      return updated;
    }

    const existingForUser = await this.findByPlatform(params.platform, tenantId);
    if (existingForUser) {
      if (existingForUser.platformUserId !== params.platformUserId) {
        throw new MessengerAccountLinkRelinkRequiredError();
      }

      const [updated] = await this.db
        .update(messengerAccountLinks)
        .set({
          activeAgentId: params.activeAgentId ?? existingForUser.activeAgentId,
          platformUsername: params.platformUsername ?? null,
          updatedAt: now,
        })
        .where(eq(messengerAccountLinks.id, existingForUser.id))
        .returning();
      return updated;
    }

    throw new Error('MessengerAccountLink upsert could not resolve the final row state');
  };

  delete = async (id: string) => {
    return this.db
      .delete(messengerAccountLinks)
      .where(and(eq(messengerAccountLinks.id, id), eq(messengerAccountLinks.userId, this.userId)));
  };

  deleteByPlatform = async (platform: string, tenantId?: string) => {
    const conditions: SQL[] = [
      eq(messengerAccountLinks.userId, this.userId),
      eq(messengerAccountLinks.platform, platform),
    ];
    if (tenantId !== undefined) {
      conditions.push(eq(messengerAccountLinks.tenantId, tenantId));
    }
    return this.db.delete(messengerAccountLinks).where(and(...conditions));
  };

  list = async (): Promise<MessengerAccountLinkItem[]> => {
    return this.db
      .select()
      .from(messengerAccountLinks)
      .where(eq(messengerAccountLinks.userId, this.userId));
  };

  /**
   * Find the user's link for a given platform. Without `tenantId` returns the
   * single link if there is exactly one, or undefined otherwise — useful for
   * Telegram where the user only ever has one. With `tenantId` returns the
   * specific row (Slack workspace A vs B).
   */
  findByPlatform = async (
    platform: string,
    tenantId?: string,
  ): Promise<MessengerAccountLinkItem | undefined> => {
    const conditions: SQL[] = [
      eq(messengerAccountLinks.userId, this.userId),
      eq(messengerAccountLinks.platform, platform),
    ];
    if (tenantId !== undefined) {
      conditions.push(eq(messengerAccountLinks.tenantId, tenantId));
    }

    const [result] = await this.db
      .select()
      .from(messengerAccountLinks)
      .where(and(...conditions))
      .limit(1);
    return result;
  };

  /** Update which agent the IM session is currently routed to. */
  setActiveAgent = async (
    platform: string,
    agentId: string | null,
    tenantId?: string,
  ): Promise<MessengerAccountLinkItem | undefined> => {
    const conditions: SQL[] = [
      eq(messengerAccountLinks.userId, this.userId),
      eq(messengerAccountLinks.platform, platform),
    ];
    if (tenantId !== undefined) {
      conditions.push(eq(messengerAccountLinks.tenantId, tenantId));
    }

    const [updated] = await this.db
      .update(messengerAccountLinks)
      .set({ activeAgentId: agentId, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    return updated;
  };

  // --------------- System-wide static methods ---------------

  /**
   * Resolve the link row for an inbound IM message. Returns the row regardless
   * of whether `activeAgentId` is set — the router decides how to handle the
   * "no active agent" case.
   *
   * `tenantId` defaults to the empty string (global-bot semantics) so existing
   * Telegram-only callers keep working without code changes; Slack callers in
   * the multi-tenant router pass the resolved `team_id` / `enterprise_id`.
   */
  static findByPlatformUser = async (
    db: LobeChatDatabase,
    platform: string,
    platformUserId: string,
    tenantId: string = GLOBAL_TENANT_ID,
  ): Promise<MessengerAccountLinkItem | undefined> => {
    const [result] = await db
      .select()
      .from(messengerAccountLinks)
      .where(
        and(
          eq(messengerAccountLinks.platform, platform),
          eq(messengerAccountLinks.tenantId, tenantId),
          eq(messengerAccountLinks.platformUserId, platformUserId),
        ),
      )
      .limit(1);

    return result;
  };

  /** Static setter used by IM `/switch` (no user-scope context, but trusted by sender match). */
  static setActiveAgentById = async (
    db: LobeChatDatabase,
    linkId: string,
    agentId: string | null,
  ): Promise<MessengerAccountLinkItem | undefined> => {
    const [updated] = await db
      .update(messengerAccountLinks)
      .set({ activeAgentId: agentId, updatedAt: new Date() })
      .where(eq(messengerAccountLinks.id, linkId))
      .returning();
    return updated;
  };
}
