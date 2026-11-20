import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { TaskCommentActivityRecipient } from '@/business/server/task/notifyTaskCommentActivity';
import { notifyTaskCommentActivity } from '@/business/server/task/notifyTaskCommentActivity';
import type { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { wakeMentionedAgents } from '@/server/services/task/commentMentionWake';
import { assertAssigneeAgentBelongsToUser } from '@/server/services/task/patchValidation';
import { resolveTaskOrThrow } from '@/server/services/task/utils';
import {
  extractCommentMentionedAgentIds,
  extractCommentMentionedUserIds,
  filterActiveWorkspaceMemberIds,
  validateTaskCommentMentionedUserIds,
} from '@/server/utils/commentMentions';
import { after } from '@/server/utils/scheduleAfterResponse';

import { taskProcedureWrite } from './procedures';

/**
 * Recipients of a new comment on a task. A member comment pings the creator,
 * the member assignee and — for a reply — the members already in its thread
 * as ambient `commented` activity, upgraded to
 * `mentioned` when the comment @mentions them, and never the member who wrote
 * it. An agent-authored progress note only pings the members it explicitly
 * @mentions — including the member the agent runs for, since the agent, not
 * that member, wrote it.
 */
function collectTaskCommentRecipients(params: {
  actorUserId: string;
  isAgentAuthored: boolean;
  mentionedUserIds: string[];
  task: { assigneeUserId: string | null; createdByUserId: string };
  /** Members who already wrote in the thread a reply lands in. */
  threadParticipantIds?: string[];
}): TaskCommentActivityRecipient[] {
  const { actorUserId, isAgentAuthored, mentionedUserIds, task, threadParticipantIds } = params;
  const byUserId = new Map<string, TaskCommentActivityRecipient['kind']>();
  if (!isAgentAuthored) {
    for (const userId of [
      task.createdByUserId,
      task.assigneeUserId,
      ...(threadParticipantIds ?? []),
    ]) {
      if (userId) byUserId.set(userId, 'commented');
    }
  }
  for (const userId of mentionedUserIds) byUserId.set(userId, 'mentioned');
  if (!isAgentAuthored) byUserId.delete(actorUserId);
  return [...byUserId].map(([userId, kind]) => ({ kind, userId }));
}

/**
 * Whether a notification deep-linking to `task` would land on a page `userId`
 * cannot open. Mirrors `TaskModel.ownership()`: public tasks are visible to
 * every member, private ones only to their creator. Membership is a separate
 * check (`filterActiveWorkspaceMemberIds`).
 */
function isTaskHiddenFrom(
  task: { createdByUserId: string; visibility: 'private' | 'public' },
  userId: string,
): boolean {
  return task.visibility === 'private' && task.createdByUserId !== userId;
}

interface TaskNotificationCtx {
  serverDB: LobeChatDatabase;
  taskModel: TaskModel;
  workspaceId: string;
}

/**
 * Re-authorize every recipient against the task before any id reaches the
 * delivery slot (same contract as topic and document comments): a member
 * @mentioned on a private task they cannot see must not receive its title and
 * link, and the creator / assignee rows can outlive workspace membership.
 */
async function filterRecipientsByTaskAccess(
  ctx: TaskNotificationCtx,
  taskId: string,
  recipients: TaskCommentActivityRecipient[],
): Promise<TaskCommentActivityRecipient[]> {
  if (recipients.length === 0) return [];
  const task = await ctx.taskModel.findById(taskId);
  if (!task) return [];

  const visible = recipients.filter(({ userId }) => !isTaskHiddenFrom(task, userId));
  const activeUserIds = new Set(
    await filterActiveWorkspaceMemberIds(
      ctx.serverDB,
      ctx.workspaceId,
      visible.map(({ userId }) => userId),
    ),
  );
  return visible.filter(({ userId }) => activeUserIds.has(userId));
}

/**
 * Member comment ping (Linear-style), delivered after the response as
 * best-effort work: the `@/business` slot defaults to a no-op, and a rejecting
 * implementation must neither fail the mutation nor surface as an unhandled
 * rejection. `after()` keeps the work alive past the response on serverless.
 */
function notifyCommentActivityBestEffort(
  ctx: TaskNotificationCtx,
  params: Parameters<typeof notifyTaskCommentActivity>[0],
) {
  after(async () => {
    try {
      const recipients = await filterRecipientsByTaskAccess(ctx, params.taskId, params.recipients);
      if (recipients.length === 0) return;
      await notifyTaskCommentActivity({ ...params, recipients });
    } catch (error) {
      console.error('[task-comment] Failed to send activity notification', error);
    }
  });
}

/**
 * The thread a reply joins: the root it hangs under (a reply to a reply goes
 * to that reply's root) and the members who already wrote in it.
 */
async function resolveCommentThread(model: TaskModel, taskId: string, parentCommentId: string) {
  const parent = await model.findCommentById(parentCommentId);
  if (!parent || parent.taskId !== taskId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Parent comment not found' });
  }
  const rootId = parent.parentCommentId ?? parent.id;
  const comments = await model.getCommentThread(rootId);
  const participantUserIds = [
    ...new Set(
      comments.flatMap((c) => (c.authorUserId && !c.authorAgentId ? [c.authorUserId] : [])),
    ),
  ];
  return { participantUserIds, rootId };
}

export const commentsRouter = router({
  addComment: taskProcedureWrite
    .input(
      z.object({
        authorAgentId: z.string().optional(),
        briefId: z.string().optional(),
        content: z.string().min(1),
        editorData: z.unknown().optional(),
        id: z.string(),
        /**
         * Reply in this comment's thread. Threads are one level deep, so a
         * reply to a reply lands in the same thread, under its root.
         */
        parentCommentId: z.string().optional(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveTaskOrThrow(model, input.id);
        const thread = input.parentCommentId
          ? await resolveCommentThread(model, task.id, input.parentCommentId)
          : undefined;
        await assertAssigneeAgentBelongsToUser(
          ctx.serverDB,
          { userId: ctx.userId, workspaceId: ctx.workspaceId ?? undefined },
          input.authorAgentId,
        );
        // Resolve @mentions before the insert so an invalid editorData never
        // leaves a comment behind that nobody was told about. Markdown-only
        // comments (CLI, agent tools) mention through `<mention id="…" />`.
        const mentionedUserIds = ctx.workspaceId
          ? await validateTaskCommentMentionedUserIds(
              ctx.serverDB,
              {
                excludeUserId: input.authorAgentId ? undefined : ctx.userId,
                workspaceId: ctx.workspaceId,
              },
              input,
            )
          : [];
        const comment = await model.addComment({
          authorAgentId: input.authorAgentId,
          authorUserId: input.authorAgentId ? undefined : ctx.userId,
          briefId: input.briefId,
          content: input.content,
          editorData: input.editorData as never,
          parentCommentId: thread?.rootId,
          taskId: task.id,
          topicId: input.topicId,
          userId: ctx.userId,
        });
        // Member comment ping (Linear-style): the task creator and the member
        // assignee learn about new discussion; @mentioned members get the
        // stronger "mentioned" notification instead. Agent-authored progress
        // notes only reach the members they explicitly @mention.
        if (ctx.workspaceId) {
          const recipients = collectTaskCommentRecipients({
            actorUserId: ctx.userId,
            isAgentAuthored: Boolean(input.authorAgentId),
            mentionedUserIds,
            task,
            threadParticipantIds: thread?.participantUserIds,
          });
          if (recipients.length > 0) {
            notifyCommentActivityBestEffort(
              { serverDB: ctx.serverDB, taskModel: model, workspaceId: ctx.workspaceId },
              {
                actorAgentId: input.authorAgentId,
                actorUserId: ctx.userId,
                commentId: comment.id,
                recipients,
                taskId: task.id,
                workspaceId: ctx.workspaceId,
              },
            );
          }
        }
        // A member @mentioning agents asks them to act. Agent-authored
        // comments never wake anyone, so agents cannot set each other off.
        const mentionedAgentIds = input.authorAgentId ? [] : extractCommentMentionedAgentIds(input);
        const wakes =
          mentionedAgentIds.length > 0
            ? await wakeMentionedAgents({
                agentIds: mentionedAgentIds,
                comment,
                db: ctx.serverDB,
                task,
                userId: ctx.userId,
                workspaceId: ctx.workspaceId ?? undefined,
              })
            : [];
        return { data: comment, message: 'Comment added', success: true, wakes };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:addComment]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to add comment',
        });
      }
    }),
  deleteComment: taskProcedureWrite
    .input(z.object({ commentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const deleted = await ctx.taskModel.deleteComment(input.commentId);
        if (!deleted) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
        }
        return { message: 'Comment deleted', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:deleteComment]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete comment',
        });
      }
    }),
  updateComment: taskProcedureWrite
    .input(
      z.object({
        commentId: z.string(),
        content: z.string().min(1),
        editorData: z.unknown().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const workspaceId = ctx.workspaceId ?? undefined;
        const previous = await ctx.taskModel.findCommentById(input.commentId);
        if (!previous) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
        }
        // Only members @mentioned for the first time by this edit are pinged;
        // mentions kept from the previous revision were already notified. The
        // edit carries no agent identity, so it is attributed to the member
        // making it even when an agent wrote the original comment.
        let addedMentionUserIds: string[] = [];
        if (workspaceId) {
          const previousMentions = new Set(extractCommentMentionedUserIds(previous));
          const nextMentions = await validateTaskCommentMentionedUserIds(
            ctx.serverDB,
            { excludeUserId: ctx.userId, workspaceId },
            input,
          );
          addedMentionUserIds = nextMentions.filter((id) => !previousMentions.has(id));
        }
        const comment = await ctx.taskModel.updateComment(input.commentId, input.content, {
          editorData: input.editorData === undefined ? null : input.editorData,
        });
        if (!comment) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found' });
        }
        if (workspaceId && addedMentionUserIds.length > 0) {
          notifyCommentActivityBestEffort(
            { serverDB: ctx.serverDB, taskModel: ctx.taskModel, workspaceId },
            {
              actorUserId: ctx.userId,
              commentId: comment.id,
              recipients: addedMentionUserIds.map((userId) => ({ kind: 'mentioned', userId })),
              taskId: comment.taskId,
              workspaceId,
            },
          );
        }
        return { data: comment, message: 'Comment updated', success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('[task:updateComment]', error);
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update comment',
        });
      }
    }),
});
