import { PERMISSION_ACTIONS } from '@lobechat/const/rbac';
import { canPublishAgentTopicLink } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import type { AgentModel } from '@/database/models/agent';
import type { ChatGroupModel } from '@/database/models/chatGroup';
import { RbacModel } from '@/database/models/rbac';
import type { TopicModel } from '@/database/models/topic';
import { WorkspaceAuditLogModel } from '@/database/models/workspaceAuditLog';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';

import { assertCanUseTopicTargets } from '../_helpers/conversationResourceGuard';
import { resolveAgentIdFromSession } from '../_helpers/resolveContext';
import { guardCtx, topicProcedure } from './procedures';

interface TopicShareCtx {
  agentModel: AgentModel;
  chatGroupModel: ChatGroupModel;
  serverDB: LobeChatDatabase;
  topicModel: TopicModel;
  userId: string;
  workspaceId?: string | null;
}

/** Workspace owners hold the `:all` scope; everyone else is capped to `:owner`. */
const isWorkspaceTopicOwner = (ctx: TopicShareCtx) =>
  new RbacModel(ctx.serverDB, ctx.userId).hasPermission(`${PERMISSION_ACTIONS.TOPIC_UPDATE}:all`, {
    workspaceId: ctx.workspaceId!,
  });

/**
 * The agent a topic answers to, for policy purposes.
 *
 * Group topics resolve through their supervisor first: a group conversation
 * *is* a conversation with its supervisor, that is the row the group's
 * Permission page writes, and `createTopic` accepts a `groupId` with no agent
 * or session at all — so reading `agentId` first would leave those rows with
 * no policy to apply. Agent-native topics then carry `agentId` directly, and
 * legacy session-only rows predate that column, so resolve through the session
 * rather than letting them slip past the policy.
 */
const resolveTopicShareAgent = async (
  ctx: TopicShareCtx,
  topic: { agentId?: string | null; groupId?: string | null; sessionId?: string | null },
) => {
  const agentId =
    (topic.groupId ? await ctx.chatGroupModel.getSupervisorAgentId(topic.groupId) : null) ??
    topic.agentId ??
    (topic.sessionId
      ? await resolveAgentIdFromSession(topic.sessionId, ctx.serverDB, ctx.userId, ctx.workspaceId!)
      : undefined);
  if (!agentId) return null;

  return ctx.agentModel.getTopicShareSubject(agentId);
};

/**
 * Workspace gate for topic-share management.
 *
 * The baseline is the co-editing rule (same gate as `updateTopic`): any member
 * with `use`-level General access on the topic's conversation may manage its
 * share — view-only members stay read-only. Personal mode needs no extra check
 * — the model's ownership filter already scopes mutations to the caller.
 *
 * A topic that backs no conversation at all (legacy rows carrying neither an
 * agent, a group, nor a resolvable session) resolves to zero targets, so the
 * guard would pass for every member. Sharing is a wider grant than editing —
 * a link exposes the whole conversation to anyone holding it — so those fall
 * back to the stricter creator-or-workspace-owner rule rather than inheriting
 * the vacuous pass.
 *
 * *Publishing* narrows that further, governed by the owning agent's
 * `topicSharePolicy`. Under `restricted` only the agent's creator and
 * workspace owners may publish, which overrides even topic ownership — that is
 * the whole point of the policy. Revoking a link, and the `private`
 * placeholder the share popover creates when it opens, are never restricted:
 * pulling a topic out of circulation is always safe, and gating the
 * placeholder would leave a restricted member with a popover that cannot even
 * load its state. Pass `targetVisibility: 'link'` when the operation would
 * publish.
 */
const assertCanManageTopicShare = async (
  ctx: TopicShareCtx,
  topicId: string,
  targetVisibility?: 'link' | 'private',
) => {
  // `findOwnTopicById`: an agent-share visitor topic is stored under the
  // creator's userId, and publishing a public link for one would expose the
  // visitor's conversation. It is never a shareable topic — fail closed, and
  // do so BEFORE the personal-mode short-circuit below: visitor topics exist
  // in personal mode too, so the exclusion cannot depend on a workspace.
  const topic = await ctx.topicModel.findOwnTopicById(topicId);
  if (!topic) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Topic not found' });
  }

  // Outside a workspace the remaining checks (agent publish policy, workspace
  // ownership) have no subject — personal-mode ownership is the whole story.
  if (!ctx.workspaceId) return;

  // Publishing under a restricted agent overrides even topic ownership —
  // that is the whole point of the policy. Resolved only on the publish path
  // so the common case keeps the query count it had.
  if (targetVisibility === 'link') {
    const agent = await resolveTopicShareAgent(ctx, topic);

    if (agent && !canPublishAgentTopicLink(agent, { userId: ctx.userId })) {
      if (await isWorkspaceTopicOwner(ctx)) return;

      throw new TRPCError({
        cause: { data: { code: 'TopicShareRestrictedByAgent' } },
        code: 'FORBIDDEN',
        message: "Only the agent creator or a workspace owner can share this agent's topics",
      });
    }
  }

  if (topic.userId === ctx.userId) return;

  const guardedConversations = await assertCanUseTopicTargets(guardCtx(ctx), [topicId]);
  if (guardedConversations.length > 0) return;

  const isWorkspaceAdmin = await isWorkspaceTopicOwner(ctx);
  if (!isWorkspaceAdmin) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the topic creator or a workspace owner can manage this share',
    });
  }
};

/**
 * Audit trail for workspace share state changes, mirroring the page-share
 * `resource.shared` / `resource.unshared` events. Personal mode is not
 * audited. A share record with 'private' visibility is an unshared
 * placeholder, so only transitions in/out of 'link' are recorded.
 */
const recordTopicShareAudit = async (
  ctx: TopicShareCtx,
  params: { currentVisibility: string; previousVisibility: string; topicId: string },
) => {
  if (!ctx.workspaceId) return;
  const { currentVisibility, previousVisibility, topicId } = params;
  if (currentVisibility === previousVisibility) return;
  if (currentVisibility !== 'link' && previousVisibility !== 'link') return;

  await new WorkspaceAuditLogModel(ctx.serverDB).create({
    action: currentVisibility === 'link' ? 'resource.shared' : 'resource.unshared',
    metadata: { currentVisibility, previousVisibility },
    resourceId: topicId,
    resourceType: 'topic',
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
  });
};

export const shareRouter = router({
  /**
   * Disable sharing for a topic (deletes share record)
   */
  disableSharing: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(z.object({ topicId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertCanManageTopicShare(ctx, input.topicId);

      const previous = await ctx.topicShareModel.getByTopicId(input.topicId);
      const result = await ctx.topicShareModel.deleteByTopicId(input.topicId);

      if (previous) {
        await recordTopicShareAudit(ctx, {
          currentVisibility: 'private',
          previousVisibility: previous.visibility,
          topicId: input.topicId,
        });
      }

      return result;
    }),
  /**
   * Enable sharing for a topic (creates share record)
   */
  enableSharing: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        topicId: z.string(),
        visibility: z.enum(['private', 'link']).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanManageTopicShare(ctx, input.topicId, input.visibility);

      const previous = await ctx.topicShareModel.getByTopicId(input.topicId);
      const result = await ctx.topicShareModel.create(input.topicId, input.visibility);

      if (result) {
        await recordTopicShareAudit(ctx, {
          currentVisibility: result.visibility,
          previousVisibility: previous?.visibility ?? 'private',
          topicId: input.topicId,
        });
      }

      return result;
    }),
  getShareInfo: topicProcedure
    .input(z.object({ topicId: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.topicShareModel.getByTopicId(input.topicId);
    }),
  /**
   * Update share visibility
   */
  updateShareVisibility: topicProcedure
    .use(withScopedPermission('topic:update'))
    .input(
      z.object({
        topicId: z.string(),
        visibility: z.enum(['private', 'link']),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanManageTopicShare(ctx, input.topicId, input.visibility);

      const previous = await ctx.topicShareModel.getByTopicId(input.topicId);
      const result = await ctx.topicShareModel.updateVisibility(input.topicId, input.visibility);

      if (result && previous) {
        await recordTopicShareAudit(ctx, {
          currentVisibility: result.visibility,
          previousVisibility: previous.visibility,
          topicId: input.topicId,
        });
      }

      return result;
    }),
});
