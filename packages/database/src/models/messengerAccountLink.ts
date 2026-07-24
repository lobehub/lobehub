import { and, eq, getTableColumns, type SQL } from 'drizzle-orm';

import type { MessengerAccountLinkItem, NewMessengerAccountLink } from '../schemas';
import { messengerAccountLinks } from '../schemas';
import type { LobeChatDatabase } from '../type';

interface GateKeeper {
  decrypt: (ciphertext: string) => Promise<{ plaintext: string }>;
  encrypt: (plaintext: string) => Promise<string>;
}

export interface DecryptedMessengerAccountLink extends Omit<
  MessengerAccountLinkItem,
  'credentials'
> {
  credentials: Record<string, unknown>;
}

export type SafeMessengerAccountLink = Omit<MessengerAccountLinkItem, 'credentials'>;

interface UpsertMessengerAccountLinkParams extends Omit<
  NewMessengerAccountLink,
  'credentials' | 'id' | 'userId'
> {
  /** Plaintext JSON. The model encrypts it before persistence. */
  credentials?: Record<string, unknown>;
}

interface CredentialLookupParams {
  applicationId?: string;
  platform: string;
  platformUserId: string;
  tenantId?: string;
}

// Default projection for every row-returning query in this model: the AES-GCM
// `credentials` ciphertext must never ride along on ordinary account-link
// reads/writes — credential access requires an explicit credential-scoped
// method.
const { credentials: _credentials, ...safeLinkColumns } = getTableColumns(messengerAccountLinks);

/**
 * Tenant id for global-token platforms (Telegram today, Discord later) —
 * they have one bot serving every chat, so there's no scoping. Per-tenant
 * platforms (Slack, future Feishu / MS Teams) pass the actual tenant id.
 */
const GLOBAL_TENANT_ID = '';

const APPLICATION_UNIQUE_CONSTRAINT = 'messenger_account_links_platform_tenant_application_unique';

/**
 * Returns the violated constraint name when `error` is a Postgres unique
 * violation. Diagnostics land on `cause` (drizzle/pg wrappers) or on the error
 * itself (node-postgres driver), so read both levels.
 */
const uniqueViolationConstraint = (error: unknown): string | undefined => {
  const pgError = error as {
    cause?: { code?: string; constraint?: string };
    code?: string;
    constraint?: string;
  };
  const code = pgError.cause?.code ?? pgError.code;
  return code === '23505' ? (pgError.cause?.constraint ?? pgError.constraint) : undefined;
};

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

  // A given IM identity maps to exactly one link per `(userId, platform,
  // tenantId)` — the unique index already enforces this — so ownership is
  // purely by `userId`. `workspaceId` on the row is the *active scope* (derived
  // from the active agent), NOT part of the link's identity, so it must not
  // scope lookups; otherwise switching scope would orphan the existing link.
  private ownership = (): SQL => eq(messengerAccountLinks.userId, this.userId);

  /**
   * Map a unique violation on the application-id index to a typed conflict the
   * verify flow can turn into a friendly 409. Always throws: the claiming link
   * belongs to another user → `MessengerAccountLinkConflictError`; otherwise
   * (own bot from another IM identity, or the row vanished in a race) →
   * `MessengerAccountLinkRelinkRequiredError`.
   */
  private throwApplicationClaimConflict = async (
    platform: string,
    tenantId: string,
    applicationId: string,
  ): Promise<never> => {
    const [claimed] = await this.db
      .select(safeLinkColumns)
      .from(messengerAccountLinks)
      .where(
        and(
          eq(messengerAccountLinks.platform, platform),
          eq(messengerAccountLinks.tenantId, tenantId),
          eq(messengerAccountLinks.applicationId, applicationId),
        ),
      )
      .limit(1);

    if (claimed && claimed.userId !== this.userId) {
      throw new MessengerAccountLinkConflictError(
        claimed.userId,
        'Credential application is already linked to another LobeHub user',
      );
    }
    throw new MessengerAccountLinkRelinkRequiredError();
  };

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
    params: UpsertMessengerAccountLinkParams,
    gateKeeper?: GateKeeper,
  ): Promise<SafeMessengerAccountLink> => {
    const { credentials, ...linkParams } = params;
    const credentialsCipher = credentials
      ? await encryptCredentials(credentials, gateKeeper)
      : undefined;
    const tenantId = params.tenantId ?? GLOBAL_TENANT_ID;
    const now = new Date();

    // Try to claim the `(user, platform, tenant)` scope first. This prevents
    // concurrent verify-im confirmations from both observing "no row" and
    // then silently overwriting one another in a later update path.
    try {
      const [created] = await this.db
        .insert(messengerAccountLinks)
        .values({
          ...linkParams,
          credentials: credentialsCipher,
          tenantId,
          updatedAt: now,
          userId: this.userId,
          workspaceId: params.workspaceId ?? null,
        })
        .onConflictDoNothing({
          target: [
            messengerAccountLinks.userId,
            messengerAccountLinks.platform,
            messengerAccountLinks.tenantId,
          ],
        })
        .returning(safeLinkColumns);

      if (created) return created;
    } catch (error) {
      const constraint = uniqueViolationConstraint(error);
      if (!constraint) throw error;

      // A credential bot (`applicationId`) may only be claimed by one link.
      // The identity-based resolution below can't see this conflict (the
      // claiming row has a different `platformUserId`), so surface it here
      // instead of falling through to the generic final error.
      if (constraint === APPLICATION_UNIQUE_CONSTRAINT) {
        await this.throwApplicationClaimConflict(params.platform, tenantId, params.applicationId!);
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
      try {
        const [updated] = await this.db
          .update(messengerAccountLinks)
          .set({
            activeAgentId: params.activeAgentId ?? byIdentity.activeAgentId,
            platformUsername: params.platformUsername ?? null,
            updatedAt: now,
            workspaceId: params.workspaceId ?? null,
            // Refresh rotated user-scoped credentials on re-verify; omitting the
            // fields preserves the stored values (the row shapes we read back
            // are credential-free safe projections, so we can't backfill).
            ...(params.applicationId === undefined ? {} : { applicationId: params.applicationId }),
            ...(credentialsCipher === undefined ? {} : { credentials: credentialsCipher }),
          })
          .where(eq(messengerAccountLinks.id, byIdentity.id))
          .returning(safeLinkColumns);
        return updated;
      } catch (error) {
        // A rotated `applicationId` can collide with a bot already claimed by
        // another link — same typed conflict as the insert path.
        if (
          uniqueViolationConstraint(error) === APPLICATION_UNIQUE_CONSTRAINT &&
          params.applicationId != null
        ) {
          await this.throwApplicationClaimConflict(params.platform, tenantId, params.applicationId);
        }
        throw error;
      }
    }

    const existingForUser = await this.findByPlatform(params.platform, tenantId);
    if (existingForUser) {
      if (existingForUser.platformUserId !== params.platformUserId) {
        throw new MessengerAccountLinkRelinkRequiredError();
      }

      try {
        const [updated] = await this.db
          .update(messengerAccountLinks)
          .set({
            activeAgentId: params.activeAgentId ?? existingForUser.activeAgentId,
            platformUsername: params.platformUsername ?? null,
            updatedAt: now,
            workspaceId: params.workspaceId ?? null,
            // Same credential-refresh semantics as the identity-resolved branch.
            ...(params.applicationId === undefined ? {} : { applicationId: params.applicationId }),
            ...(credentialsCipher === undefined ? {} : { credentials: credentialsCipher }),
          })
          .where(eq(messengerAccountLinks.id, existingForUser.id))
          .returning(safeLinkColumns);
        return updated;
      } catch (error) {
        if (
          uniqueViolationConstraint(error) === APPLICATION_UNIQUE_CONSTRAINT &&
          params.applicationId != null
        ) {
          await this.throwApplicationClaimConflict(params.platform, tenantId, params.applicationId);
        }
        throw error;
      }
    }

    throw new Error('MessengerAccountLink upsert could not resolve the final row state');
  };

  delete = async (id: string) => {
    return this.db
      .delete(messengerAccountLinks)
      .where(and(eq(messengerAccountLinks.id, id), this.ownership()));
  };

  deleteByPlatform = async (platform: string, tenantId?: string) => {
    const conditions: SQL[] = [this.ownership(), eq(messengerAccountLinks.platform, platform)];
    if (tenantId !== undefined) {
      conditions.push(eq(messengerAccountLinks.tenantId, tenantId));
    }
    return this.db.delete(messengerAccountLinks).where(and(...conditions));
  };

  list = async (): Promise<SafeMessengerAccountLink[]> => {
    return this.db.select(safeLinkColumns).from(messengerAccountLinks).where(this.ownership());
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
  ): Promise<SafeMessengerAccountLink | undefined> => {
    const conditions: SQL[] = [this.ownership(), eq(messengerAccountLinks.platform, platform)];
    if (tenantId !== undefined) {
      conditions.push(eq(messengerAccountLinks.tenantId, tenantId));
    }

    const [result] = await this.db
      .select(safeLinkColumns)
      .from(messengerAccountLinks)
      .where(and(...conditions))
      .limit(1);
    return result;
  };

  findById = async (
    id: string,
    platform?: string,
  ): Promise<SafeMessengerAccountLink | undefined> => {
    const conditions: SQL[] = [this.ownership(), eq(messengerAccountLinks.id, id)];
    if (platform) conditions.push(eq(messengerAccountLinks.platform, platform));

    const [result] = await this.db
      .select(safeLinkColumns)
      .from(messengerAccountLinks)
      .where(and(...conditions))
      .limit(1);
    return result;
  };

  /** Server-only lookup for a user-owned connection credential. */
  findByIdWithCredentials = async (
    id: string,
    platform: string,
    gateKeeper?: GateKeeper,
  ): Promise<DecryptedMessengerAccountLink | undefined> => {
    const [result] = await this.db
      .select()
      .from(messengerAccountLinks)
      .where(
        and(
          this.ownership(),
          eq(messengerAccountLinks.id, id),
          eq(messengerAccountLinks.platform, platform),
        ),
      )
      .limit(1);
    return result ? decryptRow(result, gateKeeper) : undefined;
  };

  /**
   * Update which agent the IM session is currently routed to, together with
   * the active scope (`workspaceId`) derived from that agent. Passing
   * `agentId: null` clears the active agent and resets the scope to personal.
   */
  setActiveAgent = async (
    platform: string,
    agentId: string | null,
    workspaceId: string | null,
    tenantId?: string,
  ): Promise<SafeMessengerAccountLink | undefined> => {
    const conditions: SQL[] = [this.ownership(), eq(messengerAccountLinks.platform, platform)];
    if (tenantId !== undefined) {
      conditions.push(eq(messengerAccountLinks.tenantId, tenantId));
    }

    const [updated] = await this.db
      .update(messengerAccountLinks)
      .set({ activeAgentId: agentId, updatedAt: new Date(), workspaceId })
      .where(and(...conditions))
      .returning(safeLinkColumns);

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
  ): Promise<SafeMessengerAccountLink | undefined> => {
    const [result] = await db
      .select(safeLinkColumns)
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

  /**
   * Server-only credential resolver for platforms whose secret is owned by
   * the account link itself. Ordinary routing lookups use the safe projection
   * above and therefore cannot accidentally expose ciphertext.
   */
  static findByPlatformUserWithCredentials = async (
    db: LobeChatDatabase,
    params: CredentialLookupParams,
    gateKeeper?: GateKeeper,
  ): Promise<DecryptedMessengerAccountLink | undefined> => {
    const tenantId = params.tenantId ?? GLOBAL_TENANT_ID;
    const conditions: SQL[] = [
      eq(messengerAccountLinks.platform, params.platform),
      eq(messengerAccountLinks.tenantId, tenantId),
      eq(messengerAccountLinks.platformUserId, params.platformUserId),
    ];
    if (params.applicationId) {
      conditions.push(eq(messengerAccountLinks.applicationId, params.applicationId));
    }

    const [result] = await db
      .select()
      .from(messengerAccountLinks)
      .where(and(...conditions))
      .limit(1);
    return result ? decryptRow(result, gateKeeper) : undefined;
  };

  /** Static setter used by IM `/switch` (no user-scope context, but trusted by sender match). */
  static setActiveAgentById = async (
    db: LobeChatDatabase,
    linkId: string,
    agentId: string | null,
  ): Promise<SafeMessengerAccountLink | undefined> => {
    const [updated] = await db
      .update(messengerAccountLinks)
      .set({ activeAgentId: agentId, updatedAt: new Date() })
      .where(eq(messengerAccountLinks.id, linkId))
      .returning(safeLinkColumns);
    return updated;
  };

  /**
   * Static scope switch used by IM `/switch`. Moves the link to a new active
   * scope (personal → `null`, or a workspace id) and sets the active agent to
   * `agentId` — callers pass the scope's default agent (inbox/LobeAI) so
   * switching never leaves the session agent-less; pass `null` only when the
   * target scope has no agents. Caller must authorize access to the target
   * scope first.
   */
  static setActiveScope = async (
    db: LobeChatDatabase,
    linkId: string,
    workspaceId: string | null,
    agentId: string | null = null,
  ): Promise<SafeMessengerAccountLink | undefined> => {
    const [updated] = await db
      .update(messengerAccountLinks)
      .set({ activeAgentId: agentId, updatedAt: new Date(), workspaceId })
      .where(eq(messengerAccountLinks.id, linkId))
      .returning(safeLinkColumns);
    return updated;
  };
}

async function encryptCredentials(
  credentials: Record<string, unknown>,
  gateKeeper?: GateKeeper,
): Promise<string> {
  const json = JSON.stringify(credentials);
  if (!gateKeeper) return json;
  return gateKeeper.encrypt(json);
}

async function decryptRow(
  row: MessengerAccountLinkItem,
  gateKeeper?: GateKeeper,
): Promise<DecryptedMessengerAccountLink> {
  if (!row.credentials) return { ...row, credentials: {} };

  try {
    const credentials = gateKeeper
      ? JSON.parse((await gateKeeper.decrypt(row.credentials)).plaintext)
      : JSON.parse(row.credentials);
    return { ...row, credentials };
  } catch {
    return { ...row, credentials: {} };
  }
}
