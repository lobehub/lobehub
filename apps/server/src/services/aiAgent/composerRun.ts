import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import type { LobeChatDatabase } from '@/database/type';
import { createTaskRunHooks } from '@/server/services/task/runHooks';
import { type TopicRunReopenOutcome, TopicRunService } from '@/server/services/task/topicRun';

import type { AiAgentService } from './index';
import type { InternalExecAgentParams } from './types';

/**
 * The request fields a composer send carries into {@link startComposerRun}.
 * Mirrors the fresh-send part of the `aiAgent.execAgent` input; the resume
 * fields are passed through untouched for the router's own resume-shaped sends.
 */
export type ComposerRunRequest = Pick<
  InternalExecAgentParams,
  | 'acceptsFileWorks'
  | 'acceptsMemberRuntimeEnd'
  | 'agentId'
  | 'agentSender'
  | 'appContext'
  | 'autoStart'
  | 'clientIds'
  | 'clientProtocol'
  | 'deviceId'
  | 'existingMessageIds'
  | 'fileIds'
  | 'includeFinalState'
  | 'llmExecutor'
  | 'localDeviceId'
  | 'mentionedAgents'
  | 'parentMessageId'
  | 'prompt'
  | 'queuedSuccessor'
  | 'replacesOperationId'
  | 'resumeApproval'
  | 'resumeApprovals'
  | 'resumeToolResult'
  | 'selectedSkillIds'
  | 'selectedToolIds'
  | 'slug'
  | 'sourceOperationId'
  | 'steer'
  | 'title'
  | 'trigger'
  | 'userInterventionConfig'
  | 'userMessage'
> & {
  clientOperations?: NonNullable<InternalExecAgentParams['clientRunSnapshot']>['operations'];
};

export interface ComposerRunContext {
  aiAgentService: Pick<AiAgentService, 'execAgent' | 'interruptTask'>;
  /** Server-derived request provenance; never client-passable. */
  clientIp?: string;
  db: LobeChatDatabase;
  /**
   * Whether the start may take the topic over from a run that still owns it,
   * as a person at the composer does (default). A server-started follow-up
   * passes `false`: it waits on the topic instead, and fails when another run
   * owns it, rather than interrupting that run.
   */
  supersedeLiveRun?: boolean;
  userAgent?: string;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Start a run the way the composer does: a message typed into a conversation.
 *
 * Shared by `aiAgent.execAgent` and the server-side drain of queued follow-ups,
 * so a follow-up the server starts on the user's behalf gets exactly what the
 * same send from the composer would — including the Task run hand-over below.
 * Callers authorize the request before calling this.
 */
export const startComposerRun = async (ctx: ComposerRunContext, input: ComposerRunRequest) => {
  const { appContext, parentMessageId } = input;

  // A message typed into a Task's own conversation continues that Task's
  // run — and the composer dispatches it, not `runTask`. Everything the Task
  // side needs for this run is attached here: the hook that settles the run
  // when it ends, and the reopen that puts its run row back in flight.
  // Without the pair, an answered run is invisible to the Task: the run card
  // keeps the finished state of the run it replied to, `cancelTopic` refuses
  // to stop the live one, and the detail page stops polling for it.
  const topicRunService = new TopicRunService(ctx.db, ctx.userId, ctx.workspaceId ?? undefined);
  const topicRun = appContext?.topicId
    ? await topicRunService.resolveOwnableRun(appContext.topicId)
    : undefined;
  // Recorded on the operation-created boundary and acted on once the
  // dispatch has returned.
  let reopenOutcome: TopicRunReopenOutcome | undefined;

  const result = await ctx.aiAgentService.execAgent({
    acceptsFileWorks: input.acceptsFileWorks,
    acceptsMemberRuntimeEnd: input.acceptsMemberRuntimeEnd,
    agentId: input.agentId,
    appContext,
    autoStart: input.autoStart,
    clientIds: input.clientIds,
    clientRunSnapshot: {
      operations: input.clientOperations ?? [],
      replacesOperationId: input.replacesOperationId,
    },
    clientProtocol: input.clientProtocol,
    includeFinalState: input.includeFinalState,
    llmExecutor: input.llmExecutor,
    // This path serves the composer (`aiAgentService.execAgentTask`).
    // The client already queues follow-ups behind a live run and shows the
    // user a tray; refusing here would only make the message disappear.
    interactiveStart: ctx.supersedeLiveRun ?? true,
    // Propagate the originating request's client IP / user agent into the run
    // so downstream LLM-call metadata can carry them for auditing and spend
    // attribution. These are server-derived from the tRPC context and are
    // intentionally not part of the client-passable input schema.
    clientIp: ctx.clientIp,
    deviceId: input.deviceId,
    localDeviceId: input.localDeviceId,
    existingMessageIds: input.existingMessageIds,
    ...(topicRun && {
      hooks: createTaskRunHooks({
        db: ctx.db,
        taskId: topicRun.taskId,
        taskIdentifier: topicRun.taskIdentifier,
        trigger: 'manual',
        // The Task's creator, not the caller: the completion callback
        // resolves the workspace from `tasks.createdByUserId`, so passing a
        // workspace member would make that lookup miss and strand the run.
        userId: topicRun.ownerUserId,
        workspaceId: ctx.workspaceId ?? undefined,
      }),
      // Before the run's first step, so a short run can never finish — and
      // have its own completion hook settle the row — ahead of the reopen.
      onOperationCreated: async (operationId) => {
        reopenOutcome = await topicRunService
          .reopen({ link: topicRun, operationId })
          .catch((error) => {
            console.error('[startComposerRun] failed to reopen the task run: %O', error);
            return 'refused' as const;
          });
      },
    }),
    fileIds: input.fileIds,
    mentionedAgents: input.mentionedAgents,
    parentMessageId,
    prompt: input.prompt,
    queuedSuccessor: input.queuedSuccessor,
    replacesOperationId: input.replacesOperationId,
    // When parentMessageId is provided, this is a regeneration/continue or a
    // human-approval resume — either way, skip user message creation.
    resume: !!parentMessageId,
    resumeApproval: input.resumeApproval,
    resumeApprovals: input.resumeApprovals,
    resumeToolResult: input.resumeToolResult,
    selectedSkillIds: input.selectedSkillIds,
    selectedToolIds: input.selectedToolIds,
    slug: input.slug,
    agentSender: input.agentSender,
    sourceOperationId: input.sourceOperationId,
    steer: input.steer,
    title: input.title,
    trigger: input.trigger ?? RequestTrigger.Chat,
    userAgent: ctx.userAgent,
    userInterventionConfig: input.userInterventionConfig,
    userMessage: input.userMessage,
  });
  // The run was dispatched but it did not take the Task's run row over. Two
  // ways that happens: the Task was retired while the run was starting (the
  // write failed or there is no row to keep honest), or a concurrent send on
  // the same topic won the reopen and already owns the row. In both cases
  // the run's hooks are already attached for the whole run, and
  // `onTopicComplete` settles the topic row by id without checking which
  // operation owns it — so letting this run continue would let the loser
  // settle a row it does not own, finishing the winner's run ahead of it and
  // overwriting its handoff/result. Stop it, exactly as the runner stops the
  // run it dispatched under the same race.
  if (reopenOutcome === 'refused' || reopenOutcome === 'already-running') {
    const lostTheRow = reopenOutcome === 'already-running';
    const stop = await ctx.aiAgentService
      .interruptTask({ operationId: result.operationId })
      .catch((error) => {
        console.error('[startComposerRun] failed to stop the orphaned task run: %O', error);
        return undefined;
      });
    // Same confirmation gate as `TaskService.interruptTaskOperation`.
    const stopped = !!stop?.success && stop.deviceCancellationConfirmed !== false;
    throw new TRPCError({
      code: stopped ? 'CONFLICT' : 'INTERNAL_SERVER_ERROR',
      message: stopped
        ? lostTheRow
          ? 'Another run is already live on this task; this duplicate send was stopped.'
          : 'This task run could not be recorded while it was starting; the run was stopped.'
        : `This task run could not be recorded while it was starting, and stopping it (operation ${result.operationId}) could not be confirmed.`,
    });
  }

  return result;
};
