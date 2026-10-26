import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { TaskCommentActivityRecipient } from '@/business/server/task/notifyTaskCommentActivity';
import { notifyTaskCommentActivity } from '@/business/server/task/notifyTaskCommentActivity';
import type { TaskModel } from '@/database/models/task';
import type { LobeChatDatabase } from '@/database/type';
import { router } from '@/libs/trpc/lambda';
import { assertAssigneeAgentBelongsToUser } from '@/server/services/task/patchValidation';
import {
  extractCommentMentionedUserIds,
  filterActiveWorkspaceMemberIds,
  validateTaskCommentMentionedUserIds,
} from '@/server/utils/commentMentions';
import { after } from '@/server/utils/scheduleAfterResponse';

import { resolveOrThrow, taskProcedureWrite } from './procedures';

/**
 * Recipients of a new comment on a task. A member comment pings the creator
 * and the member assignee as ambient `commented` activity, upgraded to
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
}): TaskCommentActivityRecipient[] {
  const { actorUserId, isAgentAuthored, mentionedUserIds, task } = params;
  const byUserId = new Map<string, TaskCommentActivityRecipient['kind']>();
  if (!isAgentAuthored) {
    for (const userId of [task.createdByUserId, task.assigneeUserId]) {
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

export const commentsRouter = router({
  addComment: taskProcedureWrite
    .input(
      z.object({
        authorAgentId: z.string().optional(),
        briefId: z.string().optional(),
        content: z.string().min(1),
        editorData: z.unknown().optional(),
        id: z.string(),
        topicId: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const model = ctx.taskModel;
        const task = await resolveOrThrow(model, input.id);
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
        return { data: comment, message: 'Comment added', success: true };
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
