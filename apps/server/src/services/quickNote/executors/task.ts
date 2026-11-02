import type { QuickNoteTaskSource } from '@lobechat/types';
import debug from 'debug';

import type { LobeChatDatabase } from '@/database/type';
import { TaskService } from '@/server/services/task';
import { TaskRunnerService } from '@/server/services/taskRunner';
import { after } from '@/server/utils/scheduleAfterResponse';

import type { QuickNoteTaskPayload } from './schemas';
import { quickNoteTaskPayloadSchema } from './schemas';
import type { QuickNoteProposalExecutor } from './types';

const log = debug('lobe-server:quick-note:executor:task');

/**
 * Creates a private Task stamped with its Quick Note source.
 *
 * Use when:
 * - A `task` Proposal is applied, or the user dives into a note.
 *
 * Expects:
 * - `db` may be a transaction; the Task is created with the user's Quick Note agent as assignee.
 *
 * Returns:
 * - The created Task row.
 */
export const createQuickNoteTask = async (params: {
  assigneeAgentId: string;
  db: LobeChatDatabase;
  payload: QuickNoteTaskPayload;
  source: QuickNoteTaskSource;
  userId: string;
  workspaceId?: string;
}) =>
  new TaskService(params.db, params.userId, params.workspaceId).createTask({
    assigneeAgentId: params.assigneeAgentId,
    context: { source: params.source },
    instruction: params.payload.instruction,
    name: params.payload.name,
    visibility: 'private',
  });

/**
 * Starts a Quick Note Task without waiting for its Agent.
 *
 * `runTask` only enqueues the first runtime step, so the caller returns before any LLM call. A
 * failed kickoff leaves the Task paused with the error attached (see `TaskRunnerService`), so it
 * is logged, not rethrown: the durable Task already exists.
 *
 * Trigger is `manual`: the user (or a score-4 judgement standing in for them) started it ad hoc,
 * which never counts against automation quotas. The Quick Note provenance lives on
 * `context.source`, so no new trigger value is needed.
 */
export const kickoffQuickNoteTask = async (params: {
  db: LobeChatDatabase;
  taskId: string;
  userId: string;
  workspaceId?: string;
}) => {
  try {
    await new TaskRunnerService(params.db, params.userId, params.workspaceId).runTask({
      taskId: params.taskId,
      trigger: 'manual',
    });
  } catch (error) {
    log('failed to start Quick Note Task %s: %O', params.taskId, error);
    console.error('[QuickNote] failed to start Task %s:', params.taskId, error);
  }
};

/**
 * Starts a Quick Note Task after the response is sent, so creating it returns immediately.
 *
 * `after()` keeps the kickoff alive past the response on serverless; outside a request it runs
 * the kickoff right away without awaiting it. Failures are logged by {@link kickoffQuickNoteTask}.
 */
export const scheduleQuickNoteTaskKickoff = (params: Parameters<typeof kickoffQuickNoteTask>[0]) =>
  after(() => kickoffQuickNoteTask(params));

/** `task` Proposals: create a research Task, then start it after commit. */
export const taskExecutor: QuickNoteProposalExecutor<'task'> = {
  execute: async (ctx, payload) => {
    const task = await createQuickNoteTask({
      assigneeAgentId: await ctx.resolveQuickNoteAgentId(ctx.db),
      db: ctx.db,
      payload,
      source: {
        proposalId: ctx.proposal.id,
        quickNoteId: ctx.proposal.quickNoteId,
        runId: ctx.proposal.runId,
        type: 'quick_note',
      },
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
    });

    return {
      afterCommit: () =>
        kickoffQuickNoteTask({
          db: ctx.rootDb,
          taskId: task.id,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        }),
      resultId: task.id,
      resultType: 'task',
    };
  },
  kind: 'task',
  schema: quickNoteTaskPayloadSchema,
};
