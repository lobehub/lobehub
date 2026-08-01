import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

import {
  aicoUserPublicIds,
  memberBudgets,
  modelAccessRules,
  type NewOrganization,
  type OrganizationInviteItem,
  organizationInvites,
  type OrganizationItem,
  type OrganizationMemberItem,
  organizationMembers,
  organizations,
  type OrganizationTeamItem,
  organizationTeamMembers,
  organizationTeams,
  platformAdmins,
  walletTransactions,
} from '../schemas/aicoOrganization';
import { users } from '../schemas/user';
import type { LobeChatDatabase } from '../type';
import { randomSlug } from '../utils/idGenerator';

export type OrgMemberRole = 'owner' | 'admin' | 'member';
export type OrgInviteRole = 'admin' | 'member';
export type OrgMemberStatus = 'invited' | 'active' | 'disabled';
export type InviteIdentifierType = 'email' | 'phone';

const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
export const DEFAULT_TEAM_NAME = 'Unspecified';
export const DEFAULT_TEAM_SLUG = 'unspecified';

const slugify = (name: string): string => {
  const base = name
    .trim()
    .toLowerCase()
    .replaceAll(/[^\da-z]+/g, '-')
    .replaceAll(/(^-|-$)/g, '')
    .slice(0, 48);
  return base || randomSlug(2);
};

export class OrganizationModel {
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  // ─── Platform admins ───────────────────────────────────────────────

  isPlatformAdmin = async (userId: string): Promise<boolean> => {
    const row = await this.db.query.platformAdmins.findFirst({
      where: eq(platformAdmins.userId, userId),
    });
    return Boolean(row);
  };

  addPlatformAdmin = async (userId: string) => {
    const [row] = await this.db
      .insert(platformAdmins)
      .values({ userId })
      .onConflictDoNothing()
      .returning();
    return row;
  };

  listPlatformAdmins = async () => {
    return this.db.query.platformAdmins.findMany({
      orderBy: [desc(platformAdmins.createdAt)],
    });
  };

  // ─── Organizations ─────────────────────────────────────────────────

  createOrganization = async (params: {
    name: string;
    ownerUserId: string;
    slug?: string;
  }): Promise<OrganizationItem> => {
    let slug = params.slug?.trim() || slugify(params.name);
    // Ensure uniqueness
    for (let i = 0; i < 5; i++) {
      const existing = await this.db.query.organizations.findFirst({
        where: eq(organizations.slug, slug),
      });
      if (!existing) break;
      slug = `${slugify(params.name)}-${randomSlug(1)}`;
    }

    return this.db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          name: params.name.trim(),
          ownerUserId: params.ownerUserId,
          slug,
        } satisfies NewOrganization)
        .returning();

      const [ownerMember] = await tx
        .insert(organizationMembers)
        .values({
          joinedAt: new Date(),
          orgId: org.id,
          role: 'owner',
          status: 'active',
          userId: params.ownerUserId,
        })
        .returning();

      const [defaultTeam] = await tx
        .insert(organizationTeams)
        .values({
          isDefault: true,
          name: DEFAULT_TEAM_NAME,
          orgId: org.id,
          slug: DEFAULT_TEAM_SLUG,
        })
        .returning();

      await tx.insert(organizationTeamMembers).values({
        orgMemberId: ownerMember.id,
        teamId: defaultTeam.id,
      });

      return org;
    });
  };

  getById = async (orgId: string) => {
    return this.db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });
  };

  /**
   * Orgs a user is an active member of. Suspended orgs are excluded by default —
   * a suspended org must not grant chat/budget access via membership lookups.
   * Pass `includeSuspended` for management/dashboard views that need to surface
   * the suspended state itself (e.g. platform admins, or the org's own "my orgs" list).
   */
  listForUser = async (
    userId: string,
    options: { includeSuspended?: boolean } = {},
  ): Promise<Array<OrganizationItem & { myRole: OrgMemberRole }>> => {
    const memberships = await this.db.query.organizationMembers.findMany({
      where: and(eq(organizationMembers.userId, userId), eq(organizationMembers.status, 'active')),
    });
    if (memberships.length === 0) return [];

    const orgs = await Promise.all(memberships.map((m) => this.getById(m.orgId)));
    return memberships
      .map((m, i) => {
        const org = orgs[i];
        if (!org) return null;
        if (!options.includeSuspended && org.status === 'suspended') return null;
        return { ...org, myRole: m.role as OrgMemberRole };
      })
      .filter(Boolean) as Array<OrganizationItem & { myRole: OrgMemberRole }>;
  };

  listOrganizations = async (params: { page?: number; pageSize?: number; query?: string } = {}) => {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const where = params.query
      ? or(
          ilike(organizations.name, `%${params.query}%`),
          ilike(organizations.slug, `%${params.query}%`),
        )
      : undefined;

    const [rows, totalRow] = await Promise.all([
      this.db
        .select()
        .from(organizations)
        .where(where)
        .orderBy(desc(organizations.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db.select({ value: count() }).from(organizations).where(where),
    ]);

    const withCounts = await Promise.all(
      rows.map(async (org) => {
        const [memberCount] = await this.db
          .select({ value: count() })
          .from(organizationMembers)
          .where(
            and(eq(organizationMembers.orgId, org.id), eq(organizationMembers.status, 'active')),
          );
        return {
          ...org,
          memberCount: Number(memberCount?.value ?? 0),
          usageCostUsd: '0',
        };
      }),
    );

    return {
      items: withCounts,
      page,
      pageSize,
      total: Number(totalRow[0]?.value ?? 0),
    };
  };

  /** Sum of every org's `wallet_balance_usd` — used for platform financial reporting. */
  getTotalWalletBalanceUsd = async (): Promise<number> => {
    const [row] = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${organizations.walletBalanceUsd}), 0)` })
      .from(organizations);
    return Number(row?.total ?? 0);
  };

  setOrganizationStatus = async (orgId: string, status: 'active' | 'suspended') => {
    const [row] = await this.db
      .update(organizations)
      .set({ status })
      .where(eq(organizations.id, orgId))
      .returning();
    return row;
  };

  assignManager = async (params: {
    orgId: string;
    role?: 'owner' | 'admin';
    userId: string;
  }): Promise<OrganizationMemberItem> => {
    const role = params.role ?? 'admin';

    return this.db.transaction(async (tx) => {
      if (role === 'owner') {
        await tx
          .update(organizations)
          .set({ ownerUserId: params.userId })
          .where(eq(organizations.id, params.orgId));

        // Demote previous active owners to admin
        await tx
          .update(organizationMembers)
          .set({ role: 'admin' })
          .where(
            and(
              eq(organizationMembers.orgId, params.orgId),
              eq(organizationMembers.role, 'owner'),
              eq(organizationMembers.status, 'active'),
            ),
          );
      }

      const existing = await tx.query.organizationMembers.findFirst({
        where: and(
          eq(organizationMembers.orgId, params.orgId),
          eq(organizationMembers.userId, params.userId),
        ),
      });

      if (existing) {
        const [updated] = await tx
          .update(organizationMembers)
          .set({
            joinedAt: existing.joinedAt ?? new Date(),
            role,
            status: 'active',
          })
          .where(eq(organizationMembers.id, existing.id))
          .returning();
        return updated;
      }

      const [created] = await tx
        .insert(organizationMembers)
        .values({
          joinedAt: new Date(),
          orgId: params.orgId,
          role,
          status: 'active',
          userId: params.userId,
        })
        .returning();
      return created;
    });
  };

  addManualCredit = async (params: {
    amountToman: number;
    amountUsd?: number;
    createdByUserId: string;
    description?: string;
    fxRate?: number;
    orgId: string;
    type?: 'topup' | 'manual_credit' | 'refund';
  }) => {
    if (params.amountToman <= 0) throw new Error('amountToman must be positive');
    const amountUsd = params.amountUsd ?? 0;
    const fxRate = params.fxRate ?? null;
    const type = params.type ?? 'manual_credit';

    return this.db.transaction(async (tx) => {
      const [txRow] = await tx
        .insert(walletTransactions)
        .values({
          amountToman: params.amountToman,
          amountUsd,
          createdByUserId: params.createdByUserId,
          description: params.description,
          fxRate,
          orgId: params.orgId,
          type,
        })
        .returning();

      const [org] = await tx
        .update(organizations)
        .set({
          walletBalanceToman: sql`${organizations.walletBalanceToman} + ${params.amountToman}`,
          walletBalanceUsd: sql`${organizations.walletBalanceUsd} + ${amountUsd}`,
        })
        .where(eq(organizations.id, params.orgId))
        .returning();

      return { organization: org, transaction: txRow };
    });
  };

  // ─── Members ───────────────────────────────────────────────────────

  getMemberRole = async (userId: string, orgId: string): Promise<OrgMemberRole | null> => {
    const row = await this.db.query.organizationMembers.findFirst({
      where: and(
        eq(organizationMembers.orgId, orgId),
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, 'active'),
      ),
    });
    return (row?.role as OrgMemberRole) ?? null;
  };

  listMembers = async (orgId: string) => {
    return this.db.query.organizationMembers.findMany({
      where: eq(organizationMembers.orgId, orgId),
      orderBy: [desc(organizationMembers.createdAt)],
    });
  };

  /** Same as {@link listMembers}, joined with each member's public short code. */
  listMembersWithPublicCodes = async (
    orgId: string,
  ): Promise<Array<OrganizationMemberItem & { publicCode: string | null }>> => {
    const rows = await this.db
      .select({
        member: organizationMembers,
        publicCode: aicoUserPublicIds.publicCode,
      })
      .from(organizationMembers)
      .leftJoin(aicoUserPublicIds, eq(aicoUserPublicIds.userId, organizationMembers.userId))
      .where(eq(organizationMembers.orgId, orgId))
      .orderBy(desc(organizationMembers.createdAt));

    return rows.map((r) => ({ ...r.member, publicCode: r.publicCode ?? null }));
  };

  updateMemberRole = async (params: { memberId: string; orgId: string; role: OrgMemberRole }) => {
    const member = await this.db.query.organizationMembers.findFirst({
      where: and(
        eq(organizationMembers.id, params.memberId),
        eq(organizationMembers.orgId, params.orgId),
      ),
    });
    if (!member) return null;

    if (member.role === 'owner' && params.role !== 'owner') {
      const owners = await this.db.query.organizationMembers.findMany({
        where: and(
          eq(organizationMembers.orgId, params.orgId),
          eq(organizationMembers.role, 'owner'),
          eq(organizationMembers.status, 'active'),
        ),
      });
      if (owners.length <= 1) {
        throw new Error('Cannot demote the last owner');
      }
    }

    const [updated] = await this.db
      .update(organizationMembers)
      .set({ role: params.role })
      .where(eq(organizationMembers.id, params.memberId))
      .returning();
    return updated;
  };

  removeMember = async (params: { memberId: string; orgId: string }) => {
    const member = await this.db.query.organizationMembers.findFirst({
      where: and(
        eq(organizationMembers.id, params.memberId),
        eq(organizationMembers.orgId, params.orgId),
      ),
    });
    if (!member) return null;
    if (member.role === 'owner') {
      throw new Error('Cannot remove the organization owner');
    }

    const [updated] = await this.db
      .update(organizationMembers)
      .set({ status: 'disabled' })
      .where(eq(organizationMembers.id, params.memberId))
      .returning();
    return updated;
  };

  // ─── Invites ───────────────────────────────────────────────────────

  createInvite = async (params: {
    identifierType: InviteIdentifierType;
    identifierValue: string;
    invitedByUserId: string;
    orgId: string;
    role: OrgInviteRole;
  }): Promise<OrganizationInviteItem> => {
    const value =
      params.identifierType === 'email'
        ? params.identifierValue.trim().toLowerCase()
        : params.identifierValue.trim();

    const [invite] = await this.db
      .insert(organizationInvites)
      .values({
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        identifierType: params.identifierType,
        identifierValue: value,
        invitedByUserId: params.invitedByUserId,
        orgId: params.orgId,
        role: params.role,
      })
      .returning();
    return invite;
  };

  getInviteByToken = async (token: string) => {
    return this.db.query.organizationInvites.findFirst({
      where: eq(organizationInvites.token, token),
    });
  };

  listPendingInvites = async (orgId: string) => {
    return this.db.query.organizationInvites.findMany({
      where: and(eq(organizationInvites.orgId, orgId), eq(organizationInvites.status, 'pending')),
      orderBy: [desc(organizationInvites.createdAt)],
    });
  };

  revokeInvite = async (params: { inviteId: string; orgId: string }) => {
    const [row] = await this.db
      .update(organizationInvites)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(organizationInvites.id, params.inviteId),
          eq(organizationInvites.orgId, params.orgId),
          eq(organizationInvites.status, 'pending'),
        ),
      )
      .returning();
    return row;
  };

  acceptInvite = async (params: {
    email?: string | null;
    phone?: string | null;
    token: string;
    userId: string;
  }): Promise<{ orgId: string; member: OrganizationMemberItem }> => {
    const invite = await this.getInviteByToken(params.token);
    if (!invite) throw new Error('INVITE_NOT_FOUND');
    if (invite.status !== 'pending') throw new Error('INVITE_NOT_PENDING');
    if (invite.expiresAt.getTime() < Date.now()) {
      await this.db
        .update(organizationInvites)
        .set({ status: 'expired' })
        .where(eq(organizationInvites.id, invite.id));
      throw new Error('INVITE_EXPIRED');
    }

    const identifier =
      invite.identifierType === 'email' ? params.email?.trim().toLowerCase() : params.phone?.trim();

    if (!identifier || identifier !== invite.identifierValue) {
      throw new Error('INVITE_IDENTIFIER_MISMATCH');
    }

    return this.db.transaction(async (tx) => {
      await tx
        .update(organizationInvites)
        .set({ status: 'accepted' })
        .where(eq(organizationInvites.id, invite.id));

      const existing = await tx.query.organizationMembers.findFirst({
        where: and(
          eq(organizationMembers.orgId, invite.orgId),
          eq(organizationMembers.userId, params.userId),
        ),
      });

      let member: OrganizationMemberItem;
      if (existing) {
        const [updated] = await tx
          .update(organizationMembers)
          .set({
            invitedByUserId: invite.invitedByUserId,
            joinedAt: new Date(),
            role: invite.role,
            status: 'active',
          })
          .where(eq(organizationMembers.id, existing.id))
          .returning();
        member = updated;
      } else {
        const [created] = await tx
          .insert(organizationMembers)
          .values({
            invitedByUserId: invite.invitedByUserId,
            joinedAt: new Date(),
            orgId: invite.orgId,
            role: invite.role,
            status: 'active',
            userId: params.userId,
          })
          .returning();
        member = created;
      }

      const teamMembership = await tx.query.organizationTeamMembers.findFirst({
        where: eq(organizationTeamMembers.orgMemberId, member.id),
      });
      if (!teamMembership) {
        const defaultTeam = await tx.query.organizationTeams.findFirst({
          where: and(
            eq(organizationTeams.orgId, invite.orgId),
            eq(organizationTeams.isDefault, true),
          ),
        });
        if (defaultTeam) {
          await tx.insert(organizationTeamMembers).values({
            orgMemberId: member.id,
            teamId: defaultTeam.id,
          });
        }
      }

      return { member, orgId: invite.orgId };
    });
  };

  findUserIdByEmail = async (email: string): Promise<string | null> => {
    const row = await this.db.query.users.findFirst({
      where: eq(users.email, email.trim().toLowerCase()),
    });
    return row?.id ?? null;
  };

  // ─── Teams ─────────────────────────────────────────────────────────

  getDefaultTeam = async (orgId: string) => {
    return this.db.query.organizationTeams.findFirst({
      where: and(eq(organizationTeams.orgId, orgId), eq(organizationTeams.isDefault, true)),
    });
  };

  listTeams = async (orgId: string) => {
    return this.db.query.organizationTeams.findMany({
      where: eq(organizationTeams.orgId, orgId),
      orderBy: [desc(organizationTeams.isDefault), desc(organizationTeams.createdAt)],
    });
  };

  createTeam = async (params: {
    name: string;
    orgId: string;
    slug?: string;
  }): Promise<OrganizationTeamItem> => {
    let slug = params.slug?.trim() || slugify(params.name);
    for (let i = 0; i < 5; i++) {
      const existing = await this.db.query.organizationTeams.findFirst({
        where: and(eq(organizationTeams.orgId, params.orgId), eq(organizationTeams.slug, slug)),
      });
      if (!existing) break;
      slug = `${slugify(params.name)}-${randomSlug(1)}`;
    }

    const [team] = await this.db
      .insert(organizationTeams)
      .values({
        isDefault: false,
        name: params.name.trim(),
        orgId: params.orgId,
        slug,
      })
      .returning();
    return team;
  };

  deleteTeam = async (params: { orgId: string; teamId: string }) => {
    const team = await this.db.query.organizationTeams.findFirst({
      where: and(
        eq(organizationTeams.id, params.teamId),
        eq(organizationTeams.orgId, params.orgId),
      ),
    });
    if (!team) return null;
    if (team.isDefault) throw new Error('CANNOT_DELETE_DEFAULT_TEAM');

    const defaultTeam = await this.getDefaultTeam(params.orgId);
    if (!defaultTeam) throw new Error('DEFAULT_TEAM_MISSING');

    return this.db.transaction(async (tx) => {
      const members = await tx.query.organizationTeamMembers.findMany({
        where: eq(organizationTeamMembers.teamId, params.teamId),
      });
      for (const m of members) {
        await tx
          .update(organizationTeamMembers)
          .set({ teamId: defaultTeam.id })
          .where(eq(organizationTeamMembers.id, m.id));
      }
      await tx.delete(modelAccessRules).where(eq(modelAccessRules.teamId, params.teamId));
      await tx.delete(organizationTeams).where(eq(organizationTeams.id, params.teamId));
      return team;
    });
  };

  assignMemberToTeam = async (params: { orgMemberId: string; orgId: string; teamId: string }) => {
    const team = await this.db.query.organizationTeams.findFirst({
      where: and(
        eq(organizationTeams.id, params.teamId),
        eq(organizationTeams.orgId, params.orgId),
      ),
    });
    if (!team) throw new Error('TEAM_NOT_FOUND');

    const member = await this.db.query.organizationMembers.findFirst({
      where: and(
        eq(organizationMembers.id, params.orgMemberId),
        eq(organizationMembers.orgId, params.orgId),
      ),
    });
    if (!member) throw new Error('MEMBER_NOT_FOUND');

    const existing = await this.db.query.organizationTeamMembers.findFirst({
      where: eq(organizationTeamMembers.orgMemberId, params.orgMemberId),
    });

    if (existing) {
      const [updated] = await this.db
        .update(organizationTeamMembers)
        .set({ teamId: params.teamId })
        .where(eq(organizationTeamMembers.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await this.db
      .insert(organizationTeamMembers)
      .values({ orgMemberId: params.orgMemberId, teamId: params.teamId })
      .returning();
    return created;
  };

  getMemberTeam = async (orgMemberId: string) => {
    const link = await this.db.query.organizationTeamMembers.findFirst({
      where: eq(organizationTeamMembers.orgMemberId, orgMemberId),
    });
    if (!link) return null;
    return this.db.query.organizationTeams.findFirst({
      where: eq(organizationTeams.id, link.teamId),
    });
  };

  setTeamModelAccess = async (params: { modelIds: string[]; orgId: string; teamId: string }) => {
    const team = await this.db.query.organizationTeams.findFirst({
      where: and(
        eq(organizationTeams.id, params.teamId),
        eq(organizationTeams.orgId, params.orgId),
      ),
    });
    if (!team) throw new Error('TEAM_NOT_FOUND');

    return this.db.transaction(async (tx) => {
      await tx
        .delete(modelAccessRules)
        .where(and(eq(modelAccessRules.teamId, params.teamId), eq(modelAccessRules.scope, 'team')));
      if (params.modelIds.length === 0) return [];

      const rows = await tx
        .insert(modelAccessRules)
        .values(
          params.modelIds.map((modelId) => ({
            modelId,
            orgId: params.orgId,
            scope: 'team' as const,
            teamId: params.teamId,
          })),
        )
        .returning();
      return rows;
    });
  };

  getTeamModelAccess = async (teamId: string) => {
    return this.db.query.modelAccessRules.findMany({
      where: and(eq(modelAccessRules.teamId, teamId), eq(modelAccessRules.scope, 'team')),
    });
  };

  /**
   * Allowed models for a member via their team.
   * Empty allow-list means all models are allowed.
   */
  getAllowedModelsForMember = async (orgMemberId: string): Promise<string[] | null> => {
    const team = await this.getMemberTeam(orgMemberId);
    if (!team) return null;
    const rules = await this.getTeamModelAccess(team.id);
    if (rules.length === 0) return null;
    return rules.map((r) => r.modelId);
  };

  // ─── Member budgets / credit allocation ────────────────────────────

  getMemberBudget = async (orgMemberId: string) => {
    return this.db.query.memberBudgets.findFirst({
      where: eq(memberBudgets.orgMemberId, orgMemberId),
    });
  };

  /**
   * Allocate USD credit from org wallet to a member budget.
   * Does not call OpenRouter — caller provisions/updates the key.
   *
   * Money-safety: the debit is a compare-and-swap `UPDATE ... WHERE wallet_balance_usd >= amount`
   * so concurrent allocations can never overspend the org wallet, even under stale JS-level reads —
   * Postgres serializes concurrent writers on the row and re-evaluates the WHERE clause each time.
   */
  allocateMemberCredit = async (params: {
    amountUsd: number;
    createdByUserId: string;
    orgId: string;
    orgMemberId: string;
  }) => {
    if (!Number.isFinite(params.amountUsd) || params.amountUsd <= 0) {
      throw new Error('amountUsd must be a positive finite number');
    }

    return this.db.transaction(async (tx) => {
      const org = await tx.query.organizations.findFirst({
        where: eq(organizations.id, params.orgId),
      });
      if (!org) throw new Error('ORG_NOT_FOUND');
      if (org.status !== 'active') throw new Error('ORG_NOT_ACTIVE');

      const member = await tx.query.organizationMembers.findFirst({
        where: and(
          eq(organizationMembers.id, params.orgMemberId),
          eq(organizationMembers.orgId, params.orgId),
        ),
      });
      if (!member) throw new Error('MEMBER_NOT_FOUND');

      const [updatedOrg] = await tx
        .update(organizations)
        .set({
          walletBalanceUsd: sql`${organizations.walletBalanceUsd} - ${params.amountUsd}`,
        })
        .where(
          and(
            eq(organizations.id, params.orgId),
            sql`${organizations.walletBalanceUsd} >= ${params.amountUsd}`,
          ),
        )
        .returning();
      if (!updatedOrg) throw new Error('INSUFFICIENT_ORG_BALANCE');

      const existing = await tx.query.memberBudgets.findFirst({
        where: eq(memberBudgets.orgMemberId, params.orgMemberId),
      });

      let budget;
      if (existing) {
        [budget] = await tx
          .update(memberBudgets)
          .set({
            isActive: true,
            limitUsd: sql`${memberBudgets.limitUsd} + ${params.amountUsd}`,
          })
          .where(eq(memberBudgets.id, existing.id))
          .returning();
      } else {
        [budget] = await tx
          .insert(memberBudgets)
          .values({
            limitUsd: params.amountUsd,
            orgMemberId: params.orgMemberId,
            period: 'total',
          })
          .returning();
      }

      const [txRow] = await tx
        .insert(walletTransactions)
        .values({
          amountToman: 0,
          amountUsd: params.amountUsd,
          createdByUserId: params.createdByUserId,
          description: `Allocate to member ${params.orgMemberId}`,
          orgId: params.orgId,
          type: 'allocate',
          userId: member.userId,
        })
        .returning();

      return { budget, organization: updatedOrg, transaction: txRow };
    });
  };

  /**
   * Reclaim a member's remaining OpenRouter credit back to the org wallet on
   * revoke/remove. Only the OpenRouter-reported `limit_remaining` is returned —
   * the caller (key service) computes it and passes it in; this method never
   * re-derives it from `limitUsd - usedUsd` to avoid double-crediting drift.
   */
  reclaimMemberRemainingCredit = async (params: {
    createdByUserId: string;
    orgId: string;
    orgMemberId: string;
    remainingUsd: number;
  }) => {
    const remaining = Number.isFinite(params.remainingUsd) ? Math.max(0, params.remainingUsd) : 0;

    return this.db.transaction(async (tx) => {
      const member = await tx.query.organizationMembers.findFirst({
        where: and(
          eq(organizationMembers.id, params.orgMemberId),
          eq(organizationMembers.orgId, params.orgId),
        ),
      });
      if (!member) throw new Error('MEMBER_NOT_FOUND');

      const existingBudget = await tx.query.memberBudgets.findFirst({
        where: eq(memberBudgets.orgMemberId, params.orgMemberId),
      });

      let budget = null as (typeof existingBudget & object) | null;
      if (existingBudget) {
        [budget] = await tx
          .update(memberBudgets)
          .set({
            isActive: false,
            limitUsd: existingBudget.usedUsd,
            openrouterKeyHash: null,
            openrouterKeyId: null,
          })
          .where(eq(memberBudgets.id, existingBudget.id))
          .returning();
      }

      const [organization] = await tx
        .update(organizations)
        .set({
          walletBalanceUsd: sql`${organizations.walletBalanceUsd} + ${remaining}`,
        })
        .where(eq(organizations.id, params.orgId))
        .returning();
      if (!organization) throw new Error('ORG_NOT_FOUND');

      const [transaction] = await tx
        .insert(walletTransactions)
        .values({
          amountToman: 0,
          amountUsd: remaining,
          createdByUserId: params.createdByUserId,
          description: `Reclaim remaining credit from member ${params.orgMemberId}`,
          orgId: params.orgId,
          type: 'reclaim',
          userId: member.userId,
        })
        .returning();

      return { budget, organization, transaction };
    });
  };

  updateMemberOpenRouterKey = async (params: {
    encryptedKey: string;
    keyId: string;
    orgMemberId: string;
  }) => {
    const existing = await this.getMemberBudget(params.orgMemberId);
    if (!existing) throw new Error('BUDGET_NOT_FOUND');

    const [row] = await this.db
      .update(memberBudgets)
      .set({
        openrouterKeyHash: params.encryptedKey,
        openrouterKeyId: params.keyId,
      })
      .where(eq(memberBudgets.id, existing.id))
      .returning();
    return row;
  };

  syncMemberBudgetUsage = async (params: { orgMemberId: string; usedUsd: number }) => {
    const [row] = await this.db
      .update(memberBudgets)
      .set({ lastSyncedAt: new Date(), usedUsd: params.usedUsd })
      .where(eq(memberBudgets.orgMemberId, params.orgMemberId))
      .returning();
    return row;
  };

  // ─── Public short codes ─────────────────────────────────────────────

  getUserPublicCode = async (userId: string): Promise<string | null> => {
    const row = await this.db.query.aicoUserPublicIds.findFirst({
      where: eq(aicoUserPublicIds.userId, userId),
    });
    return row?.publicCode ?? null;
  };

  /** Idempotently assigns a public short code to a user (e.g. `USR8F3K2Q`). */
  ensureUserPublicCode = async (userId: string): Promise<string> => {
    const existing = await this.getUserPublicCode(userId);
    if (existing) return existing;

    const [created] = await this.db
      .insert(aicoUserPublicIds)
      .values({ userId })
      .onConflictDoNothing({ target: aicoUserPublicIds.userId })
      .returning();
    if (created) return created.publicCode;

    return (await this.getUserPublicCode(userId))!;
  };

  getUserIdByPublicCode = async (publicCode: string): Promise<string | null> => {
    const row = await this.db.query.aicoUserPublicIds.findFirst({
      where: eq(aicoUserPublicIds.publicCode, publicCode.trim().toUpperCase()),
    });
    return row?.userId ?? null;
  };

  getOrgByPublicCode = async (publicCode: string) => {
    return this.db.query.organizations.findFirst({
      where: eq(organizations.publicCode, publicCode.trim().toUpperCase()),
    });
  };

  /** Batch lookup for listings (e.g. platform admin wallet table) — returns a userId → code map. */
  getUserPublicCodesByIds = async (userIds: string[]): Promise<Map<string, string>> => {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .select({ publicCode: aicoUserPublicIds.publicCode, userId: aicoUserPublicIds.userId })
      .from(aicoUserPublicIds)
      .where(inArray(aicoUserPublicIds.userId, userIds));
    return new Map(rows.map((r) => [r.userId, r.publicCode]));
  };

  // ─── Dashboard ───────────────────────────────────────────────────────

  getOrgDashboardStats = async (orgId: string) => {
    const org = await this.getById(orgId);
    if (!org) throw new Error('ORG_NOT_FOUND');

    const members = await this.listMembersWithPublicCodes(orgId);
    const activeMembers = members.filter((m) => m.status !== 'disabled');

    const memberStats = await Promise.all(
      activeMembers.map(async (m) => {
        const [budget, team] = await Promise.all([
          this.getMemberBudget(m.id),
          this.getMemberTeam(m.id),
        ]);
        const limitUsd = Number(budget?.limitUsd ?? 0);
        const usedUsd = Number(budget?.usedUsd ?? 0);
        return {
          limitUsd,
          memberId: m.id,
          publicCode: m.publicCode,
          remainingUsd: Math.max(0, limitUsd - usedUsd),
          role: m.role as OrgMemberRole,
          status: m.status as OrgMemberStatus,
          teamName: team?.name ?? null,
          usedUsd,
          userId: m.userId,
        };
      }),
    );

    const allocatedUsd = memberStats.reduce((sum, m) => sum + m.limitUsd, 0);
    const usedUsd = memberStats.reduce((sum, m) => sum + m.usedUsd, 0);
    const balanceUsd = Number(org.walletBalanceUsd);

    return {
      allocatedUsd,
      balanceToman: org.walletBalanceToman,
      balanceUsd,
      memberCount: activeMembers.length,
      members: memberStats,
      publicCode: org.publicCode,
      unallocatedUsd: balanceUsd,
      usedUsd,
    };
  };
}
