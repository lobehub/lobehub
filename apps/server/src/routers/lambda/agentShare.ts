import {
  AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE,
  AGENT_SHARE_DEVICE_ALLOW_USERS_LIMIT,
} from '@lobechat/const';
import { TRPCError } from '@trpc/server';
import { eq, inArray } from 'drizzle-orm';
import pMap from 'p-map';
import { z } from 'zod';

import { getAgentShareMonthlySpend } from '@/business/server/agent-share/spendGate';
import { getAddressBook } from '@/business/server/contact/addressBook';
import { withRbacPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentModel } from '@/database/models/agent';
import { AgentShareModel } from '@/database/models/agentShare';
import { AgentShareProfileModel } from '@/database/models/agentShareProfile';
import { FileModel } from '@/database/models/file';
import { RbacModel } from '@/database/models/rbac';
import { TopicModel } from '@/database/models/topic';
import { agents, users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { AgentService } from '@/server/services/agent';
import { listShareGrantableSkills } from '@/server/services/agentShare/grantableSkills';
import { isChannelEnabled } from '@/server/services/channel/featureGate';
import { assertCanPerformResourceAction } from '@/server/services/resourcePermission';

import { assertAgentShareCreationEnabled } from './_helpers/agentShareFeatureGate';

const agentIdInput = z.object({ agentId: z.string().trim().min(1) }).strict();

const shareVisibilitySchema = z.enum(['private', 'card', 'link']);

/**
 * One `toolGrants` entry: a tool identifier, optionally narrowed to specific
 * API names. `apis` omitted grants every API the tool offers (still subject to
 * the runtime visitor gates); `apis` present grants only the named ones, and
 * is never empty — a tool with no granted API is simply absent from the list.
 * Duplicate API names within one entry are rejected rather than silently
 * deduped, so a client bug surfaces instead of persisting a redundant row.
 */
const shareToolGrantSchema = z
  .object({
    apis: z
      .array(z.string().trim().min(1))
      .min(1)
      .refine((apis) => new Set(apis).size === apis.length, {
        message: 'Duplicate api name in a tool grant',
      })
      .optional(),
    identifier: z.string().trim().min(1),
  })
  .strict();

export const agentShareConfigSchema = z
  .object({
    allowCreatorViewSessions: z.boolean().optional(),
    allowReadMemory: z.boolean().optional(),
    autoGrantAgentTools: z.boolean().optional(),
    demoCases: z
      .array(
        z
          .object({
            description: z.string().trim().max(2000),
            prompt: z.string().trim().min(1).max(10000),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    /** Presentation-only review state; see `AgentShareConfig.declinedGrantIds`. */
    declinedGrantIds: z
      .array(z.string().trim().min(1))
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate declined identifier')
      .optional(),
    deviceAccess: z.enum(['none', 'contacts', 'allowlist', 'everyone']).optional(),
    /** Each id must also be in the scope's address book; `updateShareConfig` checks that. */
    deviceAllowUserIds: z
      .array(z.string().trim().min(1).max(64))
      .max(AGENT_SHARE_DEVICE_ALLOW_USERS_LIMIT)
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate user')
      .optional(),
    featuredWorkIds: z
      .array(z.string().trim().min(1))
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate featured Work')
      .optional(),
    /** Lists the share in the shared-Agent market; see `AgentShareConfig.listedInMarket`. */
    listedInMarket: z.boolean().optional(),
    /** Bytes; `0` is a real value (attachments off), so non-negative rather than positive. */
    maxFileStorage: z.number().int().nonnegative().optional(),
    maxMessagesPerVisitor: z.number().int().positive().optional(),
    monthlySpendLimit: z.number().nonnegative().optional(),
    /** Only clearable: the marker is set by `AgentShareModel.create` alone. */
    seedDefaultGrants: z.literal(false).optional(),
    /**
     * Skill identifiers the creator opened to visitors. An empty array is
     * accepted rather than rejected: unticking the last skill is a normal
     * write, and it reads the same as never having configured the field —
     * no skill granted.
     */
    skillGrants: z
      .array(z.string().trim().min(1))
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Duplicate skill identifier in skillGrants',
      })
      .optional(),
    /**
     * At most one entry per identifier: two entries for the same tool would
     * make the effective grant depend on the merge rule in
     * `resolveShareToolGrants` rather than on what the creator picked, so the
     * ambiguity is rejected at the door instead of silently resolved.
     */
    toolGrants: z
      .array(shareToolGrantSchema)
      .refine((grants) => new Set(grants.map((grant) => grant.identifier)).size === grants.length, {
        message: 'Duplicate tool identifier in toolGrants',
      })
      .optional(),
  })
  .strict();

export const agentShareConfigPatchSchema = agentShareConfigSchema.refine(
  (config) => Object.keys(config).length > 0,
  'Config patch cannot be empty',
);

const agentShareProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const workspaceId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      agentService: new AgentService(ctx.serverDB, ctx.userId, workspaceId),
      agentShareModel: new AgentShareModel(ctx.serverDB, ctx.userId, workspaceId, {
        authorizeMutation: workspaceId
          ? (db, agentId) =>
              assertCanPerformResourceAction({
                action: 'manage',
                db,
                resourceId: agentId,
                resourceType: 'agent',
                userId: ctx.userId,
                workspaceId,
              })
          : undefined,
      }),
      agentShareProfileModel: new AgentShareProfileModel(ctx.serverDB, ctx.userId),
    },
  });
});

const workspaceAgentShareAdminProcedure = agentShareProcedure
  .use(withRbacPermission('agent:update:all'))
  .use(async (opts) => {
    if (!opts.ctx.workspaceId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Workspace context required' });
    }

    return opts.next({ ctx: { workspaceId: opts.ctx.workspaceId } });
  });

interface AgentSharePermissionContext {
  serverDB: LobeChatDatabase;
  userId: string;
  workspaceId?: string | null;
  workspacePermissionCodes?: string[];
}

/**
 * Workspace shares are authority over an Agent, not another General Access
 * grade: private Agents stay creator-only, while public Agents are manageable
 * by their creator or a Workspace admin with `agent:update:all`.
 */
const assertCanManageAgentShare = async (
  ctx: AgentSharePermissionContext,
  agentId: string,
): Promise<void> => {
  if (!ctx.workspaceId) return;

  await assertCanPerformResourceAction({
    action: 'manage',
    db: ctx.serverDB,
    grantedPermissions: ctx.workspacePermissionCodes,
    resourceId: agentId,
    resourceType: 'agent',
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
};

/**
 * The address book a share's device grant draws from: the owner's personal
 * contacts for a personal Agent, the workspace's members and external
 * contacts for a workspace Agent. Keyed by the Agent's owner, exactly as the
 * runtime re-check (`resolveShareVisitorDeviceAccess`) is, so a workspace
 * manager other than the owner lists and saves the same people the run then
 * accepts. `enabled` mirrors the runtime's Channels gate on the same owner.
 */
const shareAddressBook = async (ctx: AgentSharePermissionContext, agentId: string) => {
  const [agent] = await ctx.serverDB
    .select({ userId: agents.userId })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  const ownerId = agent?.userId ?? ctx.userId;
  return {
    book: getAddressBook(ctx.serverDB, ownerId, ctx.workspaceId),
    enabled: await isChannelEnabled(ownerId),
  };
};

/** `updateConfig` / `updateVisibility` / `updateSlug` all return `null` when the share (or its owning agent) does not resolve for this caller. */
const requireShare = <T>(share: T | null): T => {
  if (!share) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Agent share not found' });
  }

  return share;
};

export const agentShareRouter = router({
  /**
   * Turning sharing OFF is a pause, not a revocation: the row (and with it the
   * share id and custom slug the owner handed out) is kept and only flipped to
   * `private`, so re-enabling later resolves the very same link. Visitors are
   * locked out in the meantime — `getSharedAgent` and the runtime's
   * `isRunStillAuthorized` both require `link`.
   */
  disableShare: agentShareProcedure.input(agentIdInput).mutation(async ({ input, ctx }) => {
    await assertCanManageAgentShare(ctx, input.agentId);
    return requireShare(await ctx.agentShareModel.updateVisibility(input.agentId, 'private'));
  }),

  /**
   * Let the Agent be shared by card, in one step from a card's send: a missing share is created
   * as `card`, a paused one resumes as `card`, a live one is left as it is. A `card` share admits
   * only the people who add the Agent from its owner's card; its link page stays closed. Same
   * preconditions as publishing a link.
   */
  enableCardShare: agentShareProcedure.input(agentIdInput).mutation(async ({ input, ctx }) => {
    await assertCanManageAgentShare(ctx, input.agentId);
    await assertAgentShareCreationEnabled(ctx.userId);

    return ctx.agentService.withShareModelLock(input.agentId, async (service, shares) => {
      await service.prepareShareModel(input.agentId);
      const share = await shares.create(input.agentId, 'card');
      if (share.visibility !== 'private') return share;
      return requireShare(await shares.updateVisibility(input.agentId, 'card'));
    });
  }),

  enableShare: agentShareProcedure
    .input(agentIdInput.extend({ visibility: shareVisibilitySchema.optional() }).strict())
    .mutation(async ({ input, ctx }) => {
      await assertCanManageAgentShare(ctx, input.agentId);
      await assertAgentShareCreationEnabled(ctx.userId);

      const visibility = input.visibility;
      if (visibility === 'link' || visibility === 'card') {
        return ctx.agentService.withShareModelLock(input.agentId, async (service, shares) => {
          await service.prepareShareModel(input.agentId);
          return shares.create(input.agentId, visibility);
        });
      }

      return ctx.agentShareModel.create(input.agentId, visibility);
    }),

  /** The people this Agent's share admits by card, for its owner's share settings. */
  listCardGrants: agentShareProcedure.input(agentIdInput).query(async ({ input, ctx }) => {
    await assertCanManageAgentShare(ctx, input.agentId);
    return ctx.agentShareModel.listGrants(input.agentId);
  }),

  /** Withdraw one person's card grant; a run of theirs stops at its next step. */
  revokeCardGrant: agentShareProcedure
    .input(agentIdInput.extend({ userId: z.string().trim().min(1) }).strict())
    .mutation(async ({ input, ctx }) => {
      await assertCanManageAgentShare(ctx, input.agentId);
      return { revoked: await ctx.agentShareModel.revokeGrant(input.agentId, input.userId) };
    }),

  /**
   * Minimal Workspace-wide audit inventory. `agent:update:all` is held by
   * administrators, while the model projection intentionally omits private
   * Agent configuration and visitor conversation content.
   */
  getWorkspaceShareAudit: workspaceAgentShareAdminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().nonnegative().default(0),
        })
        .strict(),
    )
    .query(({ input, ctx }) =>
      AgentShareModel.listWorkspaceSharesForAudit(ctx.serverDB, ctx.workspaceId, input),
    ),

  /**
   * Aggregate usage of one share, for its owner only — `getByAgentId` is
   * ownership-scoped, so a non-owner never gets past the NOT_FOUND below.
   *
   * Visitor counts come from `topics.senderId` (set for share-originated
   * topics only); `monthlySpend` comes from the billing business slot and is
   * `null` in deployments that do not meter share spend, which the UI renders
   * as "no spend data" rather than as zero. `fileStorageUsed` is the settled
   * bytes visitors have uploaded through this share — the same sum
   * `shareChat.createUploadUrl` holds against `maxFileStorage` (minus
   * in-flight reservations, which are transient) — so the owner can see how
   * close the share is to its cap, including drafts visitors never sent.
   */
  getShareStats: agentShareProcedure.input(agentIdInput).query(async ({ input, ctx }) => {
    await assertCanManageAgentShare(ctx, input.agentId);
    const share = requireShare(await ctx.agentShareModel.getByAgentId(input.agentId));
    const resolvedShare = requireShare(await AgentShareModel.findByShareId(ctx.serverDB, share.id));

    const topicModel = new TopicModel(
      ctx.serverDB,
      resolvedShare.ownerId,
      resolvedShare.workspaceId ?? undefined,
    );
    const fileModel = new FileModel(
      ctx.serverDB,
      resolvedShare.ownerId,
      resolvedShare.workspaceId ?? undefined,
    );
    const [visitors, monthlySpend, fileStorageUsed] = await Promise.all([
      topicModel.countShareVisitors({ agentId: input.agentId }),
      getAgentShareMonthlySpend({
        agentId: input.agentId,
        ownerUserId: resolvedShare.ownerId,
        shareId: share.id,
        workspaceId: resolvedShare.workspaceId ?? undefined,
      }),
      fileModel.countAgentShareUsage(share.id),
    ]);

    return {
      fileStorageUsed,
      maxFileStorage: share.shareConfig.maxFileStorage ?? AGENT_SHARE_DEFAULT_MAX_FILE_STORAGE,
      monthlySpend,
      monthlySpendLimit: share.shareConfig.monthlySpendLimit,
      topicCount: visitors.topicCount,
      // Raw page-view count (`agentShares.userViewCount`): bumped on every
      // non-owner page load, NOT deduplicated by visitor — a repeat visitor
      // inflates this every reload. For unique visitors, use `visitorCount`
      // below (distinct `topics.senderId` via `countShareVisitors`).
      userViewCount: share.userViewCount,
      visitorCount: visitors.visitorCount,
    };
  }),

  getShareStatus: agentShareProcedure.input(agentIdInput).query(async ({ input, ctx }) => {
    await assertCanManageAgentShare(ctx, input.agentId);
    return ctx.agentShareModel.getByAgentId(input.agentId);
  }),

  /**
   * Administrator emergency stop for any share in the active Workspace,
   * including private Agents the administrator cannot otherwise configure.
   */
  forceDisableWorkspaceShare: workspaceAgentShareAdminProcedure
    .input(z.object({ shareId: z.string().uuid() }).strict())
    .mutation(async ({ input, ctx }) =>
      requireShare(
        await AgentShareModel.forceDisableWorkspaceShare(
          ctx.serverDB,
          ctx.workspaceId,
          input.shareId,
          {
            authorizeMutation: async (db) => {
              const allowed = await new RbacModel(db, ctx.userId).hasPermission(
                'agent:update:all',
                { workspaceId: ctx.workspaceId },
              );
              if (!allowed) {
                throw new TRPCError({
                  code: 'FORBIDDEN',
                  message: 'You do not have permission to perform this action.',
                });
              }
            },
          },
        ),
      ),
    ),

  /** Owner-only candidate Works for the share profile editor. */
  listEligibleWorks: agentShareProcedure
    .input(
      agentIdInput.extend({
        includeWorkIds: z
          .array(z.string().trim().min(1))
          .max(100)
          .refine((ids) => new Set(ids).size === ids.length, 'Duplicate selected Work')
          .optional(),
        limit: z.number().int().positive().max(50).optional(),
        offset: z.number().int().nonnegative().max(10000).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      requireShare(await ctx.agentShareModel.getByAgentId(input.agentId));
      return ctx.agentShareProfileModel.listEligibleWorks(input.agentId, {
        includeWorkIds: input.includeWorkIds ?? [],
        limit: input.limit,
        offset: input.offset,
      });
    }),
  /**
   * Skills this agent could offer a visitor — the candidate list behind the
   * share settings skill picker (see `listShareGrantableSkills`).
   *
   * Authorization matches the other share reads: `assertCanManageAgentShare`
   * for the workspace case, then `requireShare` on the ownership-scoped
   * `getByAgentId`. Both matter here — this lists the CREATOR's whole skill
   * catalog, so a workspace member who cannot manage the Agent must not reach
   * the reads below.
   */
  listGrantableSkills: agentShareProcedure.input(agentIdInput).query(async ({ input, ctx }) => {
    await assertCanManageAgentShare(ctx, input.agentId);
    requireShare(await ctx.agentShareModel.getByAgentId(input.agentId));

    const workspaceId = ctx.workspaceId ?? undefined;
    const agentConfig = await new AgentModel(
      ctx.serverDB,
      ctx.userId,
      workspaceId,
    ).getAgentConfigById(input.agentId);

    return listShareGrantableSkills({
      agentConfig,
      agentId: input.agentId,
      db: ctx.serverDB,
      includeLegacyBuiltinSkills: true,
      userId: ctx.userId,
      workspaceId,
    });
  }),

  /**
   * Who the execution-environment grant can name: the address book of the
   * share's scope (`AddressBook.listAddressBookPeople`). `unlisted` resolves
   * the profiles of already-granted people who have since left that book, so
   * the settings page can show them as no longer authorized instead of an id.
   * `enabled` is false while the address book itself is off for the caller
   * (Channels flag): nobody can be added then, and runtime grants nothing.
   */
  listDeviceGrantablePeople: agentShareProcedure
    .input(agentIdInput)
    .query(async ({ input, ctx }) => {
      await assertCanManageAgentShare(ctx, input.agentId);
      const share = requireShare(await ctx.agentShareModel.getByAgentId(input.agentId));

      const { book, enabled } = await shareAddressBook(ctx, input.agentId);
      const people = enabled ? await book.listAddressBookPeople() : [];
      const inBook = new Set(people.map((person) => person.id));
      const outside = (share.shareConfig.deviceAllowUserIds ?? []).filter((id) => !inBook.has(id));
      // Approved by request: authorized outside the book, so listed as people, not as unlisted.
      const approvedIds = new Set(
        await AgentShareModel.requestGrantedUserIds(ctx.serverDB, share.id, outside),
      );
      const [unlisted, approved] = await Promise.all([
        pMap(
          outside.filter((id) => !approvedIds.has(id)),
          (id) => book.findUser(id),
          { concurrency: 5 },
        ),
        approvedIds.size
          ? ctx.serverDB
              .select({
                avatar: users.avatar,
                fullName: users.fullName,
                id: users.id,
                username: users.username,
              })
              .from(users)
              .where(inArray(users.id, [...approvedIds]))
          : [],
      ]);

      return {
        enabled,
        people: [...people, ...approved],
        unlisted: unlisted.filter((user) => !!user),
      };
    }),

  updateShareConfig: agentShareProcedure
    .input(
      z
        .object({
          agentId: z.string().trim().min(1),
          config: agentShareConfigPatchSchema,
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanManageAgentShare(ctx, input.agentId);

      const { deviceAccess, deviceAllowUserIds } = input.config;
      if (
        deviceAccess === 'allowlist' ||
        deviceAccess === 'contacts' ||
        deviceAllowUserIds?.length
      ) {
        const { book, enabled } = await shareAddressBook(ctx, input.agentId);
        // The runtime grants nothing while contacts are off, so refuse to store
        // a grant that would silently do nothing (or wake up when they turn on).
        if (!enabled)
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Device access needs contacts, which are not available',
          });
        const inBook = new Set(
          deviceAllowUserIds?.length ? await book.filterAddressBookPeople(deviceAllowUserIds) : [],
        );
        // People the owner let in by approving their request to use the Agent stay listable
        // outside the book: their request grant admits them (`resolveShareVisitorDeviceAccess`).
        const outside = deviceAllowUserIds?.filter((id) => !inBook.has(id)) ?? [];
        const share = outside.length
          ? await ctx.agentShareModel.getByAgentId(input.agentId)
          : undefined;
        const approved = new Set(
          share ? await AgentShareModel.requestGrantedUserIds(ctx.serverDB, share.id, outside) : [],
        );
        if (outside.some((id) => !approved.has(id)))
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Device access can only be granted to people in your contacts',
          });
      }

      return requireShare(await ctx.agentShareModel.updateConfig(input.agentId, input.config));
    }),

  /**
   * Custom URL slug for this share's public link. Pattern/reserved-word
   * validation runs again inside `AgentShareModel.updateSlug` — this router
   * check exists only to fail obviously-malformed input as `BAD_REQUEST`
   * before it reaches the ownership-locking transaction. `slug: null` clears
   * the custom slug.
   */
  updateSlug: agentShareProcedure
    .input(
      z
        .object({
          agentId: z.string().trim().min(1),
          slug: z.string().trim().toLowerCase().min(3).max(64).nullable(),
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanManageAgentShare(ctx, input.agentId);
      return requireShare(await ctx.agentShareModel.updateSlug(input.agentId, input.slug));
    }),

  updateVisibility: agentShareProcedure
    .input(
      z
        .object({
          agentId: z.string().trim().min(1),
          visibility: shareVisibilitySchema,
        })
        .strict(),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanManageAgentShare(ctx, input.agentId);
      // Flipping to `link` or `card` admits others, so it is the same capability
      // as `enableShare`; going back to `private` unpublishes and stays open.
      const visibility = input.visibility;
      if (visibility === 'link' || visibility === 'card') {
        await assertAgentShareCreationEnabled(ctx.userId);
        return ctx.agentService.withShareModelLock(input.agentId, async (service, shares) => {
          await service.prepareShareModel(input.agentId);
          return requireShare(await shares.updateVisibility(input.agentId, visibility));
        });
      }

      return requireShare(
        await ctx.agentShareModel.updateVisibility(input.agentId, input.visibility),
      );
    }),
});

export type AgentShareConfigInput = z.infer<typeof agentShareConfigSchema>;
export type AgentShareConfigPatchInput = z.infer<typeof agentShareConfigPatchSchema>;
export type AgentShareRouter = typeof agentShareRouter;
