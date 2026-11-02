import { randomUUID } from 'node:crypto';

import type { ExecAgentResult } from '@lobechat/types';
import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import pMap from 'p-map';

import {
  type AgentInterventionShareVisitorScope,
  type AgentInterventionSourceAction,
  resolveAgentInterventionBySource,
} from '@/business/server/agent-run/agentInterventionReview';
import type { MessageModel } from '@/database/models/message';
import { HumanApprovalAlreadyResolvedError } from '@/database/models/message';
import { router } from '@/libs/trpc/lambda';
import { unwrapPgError } from '@/server/modules/AgentRuntime/pgError';
import { toClientExecAgentResult } from '@/server/routers/lambda/_helpers/groupMemberContinuationResult';
import { assertCanUseWorkspaceAgent } from '@/server/routers/lambda/_helpers/workspaceAgentGuard';
import { startComposerRun } from '@/server/services/aiAgent/composerRun';
import { RequestedDeviceIgnoredError } from '@/server/services/aiAgent/pipeline/turnSetup';
import { AgentRelayHopLimitError } from '@/server/services/aiAgent/sourceAttribution';
import {
  ForeignLiveRunError,
  TopicStartReservationError,
} from '@/server/services/aiAgent/topicStartReservation';

import type { ExecAgentInput } from './execSchemas';
import {
  ExecAgentSchema,
  ExecAgentsSchema,
  ExecGroupAgentSchema,
  ExecSubAgentTaskSchema,
  foldLegacyUserMessageFields,
  ScheduleAgentRunSchema,
} from './execSchemas';
import { assertCanUseAgentRunConversation } from './guards';
import type { AgentInterventionDispatchContext } from './interventionDispatch';
import { dispatchClaimedAgentIntervention } from './interventionDispatch';
import { aiAgentWriteProcedure } from './procedures';
import { acceptsFileWorksOf, acceptsMemberRuntimeEndOf } from './utils';

const log = debug('lobe-server:ai-agent-router');

/**
 * Cross-version bridge: older Web clients call execAgent directly with resume
 * payloads and know nothing about the v2 source endpoint. Recover the
 * authoritative operation/batch from the tool rows and claim the same generic
 * intervention before the legacy message CAS can run.
 *
 * Shared by the owner `execAgent` and the share-visitor `shareChat.execAgent`
 * resume paths; `shareVisitor` scopes the claim to the visitor's own share run.
 * Resolves `undefined` when no durable generic row exists (OSS, or a pre-v2
 * row), so the caller continues with the legacy message-row resume.
 */
export const bridgeLegacyResumeToSourceIntervention = async (
  params: {
    messageModel: MessageModel;
    parentMessageId?: string;
    resumeApproval?: ExecAgentInput['resumeApproval'];
    resumeApprovals?: ExecAgentInput['resumeApprovals'];
    resumeToolResult?: ExecAgentInput['resumeToolResult'];
    shareVisitor?: AgentInterventionShareVisitorScope;
  },
  ctx: AgentInterventionDispatchContext,
  /** Forwarded to {@link dispatchClaimedAgentIntervention}; see its `options`. */
  options: { acceptsFileWorks?: boolean; acceptsMemberRuntimeEnd?: boolean } = {},
): Promise<ExecAgentResult | undefined> => {
  const {
    messageModel,
    parentMessageId,
    resumeApproval,
    resumeApprovals,
    resumeToolResult,
    shareVisitor,
  } = params;

  const legacyResumeTargets = [
    ...(resumeApprovals ?? []),
    ...(resumeApproval ? [resumeApproval] : []),
    ...(resumeToolResult
      ? [
          {
            decision: 'approved' as const,
            parentMessageId: resumeToolResult.parentMessageId,
            toolCallId: resumeToolResult.toolCallId,
          },
        ]
      : []),
  ];
  if (legacyResumeTargets.length > 0) {
    const plugins = await pMap(
      legacyResumeTargets,
      ({ parentMessageId }) => messageModel.findMessagePlugin(parentMessageId),
      { concurrency: 5 },
    );
    const firstIntervention = plugins[0]?.intervention;
    const hasGenericSource = Boolean(
      firstIntervention?.operationId &&
      firstIntervention.batchId &&
      plugins.every(
        (plugin) =>
          plugin?.intervention?.operationId === firstIntervention.operationId &&
          plugin?.intervention?.batchId === firstIntervention.batchId,
      ),
    );

    if (hasGenericSource) {
      let sourceAction: AgentInterventionSourceAction | undefined;
      if (resumeToolResult) {
        if (resumeToolResult.outcome === 'skipped') {
          sourceAction = { type: 'skip_interaction' };
        } else {
          const pluginState = resumeToolResult.pluginState as
            | {
                askUserAnswers?: Record<string, unknown>;
                selectedAgentIds?: unknown;
              }
            | undefined;
          const answers = pluginState?.askUserAnswers;
          if (
            answers &&
            Object.keys(answers).length > 0 &&
            Object.values(answers).every(
              (answer) =>
                typeof answer === 'string' ||
                (Array.isArray(answer) && answer.every((item) => typeof item === 'string')),
            )
          ) {
            sourceAction = {
              result: answers as Record<string, string | string[]>,
              type: 'submit_answers',
            };
          } else if (
            plugins[0]?.identifier === 'lobe-web-onboarding' &&
            plugins[0]?.apiName === 'showAgentMarketplace' &&
            Array.isArray(pluginState?.selectedAgentIds) &&
            pluginState.selectedAgentIds.every((id) => typeof id === 'string')
          ) {
            sourceAction = {
              result: {
                kind: 'agent_marketplace',
                selectedTemplateIds: pluginState.selectedAgentIds as string[],
              },
              type: 'submit_custom',
            };
          }
        }
      } else if (legacyResumeTargets.every(({ decision }) => decision === 'approved')) {
        // The legacy resume envelope has neither staged edits nor remember
        // intent. Cloud therefore compares the durable revision with the
        // authoritative message arguments and rejects a pre-mutated old
        // edit as stale with a refresh-required conflict; it must never
        // reinterpret already-written client state as an atomic edit.
        // Old clients may also have changed their personal allow-list
        // before this call, which remains a rollout-only non-atomic edge.
        // Current Web sends both edits and remember through the source
        // endpoint before any side effect.
        sourceAction = { scope: 'once', type: 'approve_tool' };
      } else if (
        legacyResumeTargets.every(
          ({ decision }) => decision === 'rejected' || decision === 'rejected_continue',
        )
      ) {
        const reasons = [
          ...new Set(
            legacyResumeTargets
              .map(({ rejectionReason }) => rejectionReason)
              .filter((reason): reason is string => Boolean(reason)),
          ),
        ];
        sourceAction = {
          ...(reasons.length === 1 && { reason: reasons[0] }),
          type: 'reject_continue',
        };
      }

      if (!sourceAction) {
        throw new Error('Unsupported legacy intervention payload for a durable generic row');
      }

      const sourceResolution = await resolveAgentInterventionBySource({
        action: sourceAction,
        actorUserId: ctx.userId,
        batchId: firstIntervention!.batchId!,
        operationId: firstIntervention!.operationId!,
        resolutionRequestId: randomUUID(),
        targets: legacyResumeTargets.map(({ parentMessageId, toolCallId }) => ({
          toolCallId,
          toolMessageId: parentMessageId,
        })),
        ...(shareVisitor && { shareVisitor }),
        workspaceId: ctx.workspaceId ?? undefined,
      });
      if (sourceResolution.handled) {
        if (sourceResolution.state === 'already_resolved') {
          throw new HumanApprovalAlreadyResolvedError(parentMessageId ?? 'intervention');
        }
        const dispatch = await dispatchClaimedAgentIntervention(sourceResolution, ctx, options);
        if (!dispatch.execution) {
          throw new Error('Durable intervention resume did not create an operation');
        }
        return toClientExecAgentResult(dispatch.execution);
      }
    }
  }

  return undefined;
};

export const execRouter = router({
  execAgent: aiAgentWriteProcedure.input(ExecAgentSchema).mutation(async ({ input, ctx }) => {
    const {
      agentId,
      slug,
      prompt,
      appContext,
      existingMessageIds = [],
      parentMessageId,
      resumeApproval,
      resumeApprovals,
      resumeToolResult,
      supersedeLiveRun = true,
    } = input;

    log('execAgent: identifier=%s, prompt=%s', agentId || slug, prompt.slice(0, 50));

    try {
      await assertCanUseWorkspaceAgent({
        agentId,
        db: ctx.serverDB,
        groupId: appContext?.groupId,
        slug,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });
      await assertCanUseAgentRunConversation({
        db: ctx.serverDB,
        messageIds: [
          ...existingMessageIds,
          parentMessageId,
          // A new subtopic branches off an existing message — authorize that
          // anchor too, or a caller could fork a thread off someone else's turn.
          appContext?.newThread?.sourceMessageId,
          resumeApproval?.parentMessageId,
          // Every batch target is authorized too — a caller must not be able to
          // slip a message it doesn't own into the list behind an owned anchor.
          ...(resumeApprovals ?? []).map((decision) => decision.parentMessageId),
          resumeToolResult?.parentMessageId,
        ],
        topicId: appContext?.topicId,
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
      });

      const bridged = await bridgeLegacyResumeToSourceIntervention(
        {
          messageModel: ctx.messageModel,
          parentMessageId,
          resumeApproval,
          resumeApprovals,
          resumeToolResult,
        },
        ctx,
        {
          acceptsFileWorks: acceptsFileWorksOf(input.streamFeatures),
          acceptsMemberRuntimeEnd: acceptsMemberRuntimeEndOf(input.streamFeatures),
        },
      );
      if (bridged) return bridged;

      const { supersedeLiveRun: _supersede, ...request } = foldLegacyUserMessageFields(input);
      const result = await startComposerRun(
        {
          aiAgentService: ctx.aiAgentService,
          clientIp: ctx.clientIp ?? undefined,
          db: ctx.serverDB,
          supersedeLiveRun,
          userAgent: ctx.userAgent ?? undefined,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        },
        {
          ...request,
          acceptsFileWorks: acceptsFileWorksOf(input.streamFeatures),
          acceptsMemberRuntimeEnd: acceptsMemberRuntimeEndOf(input.streamFeatures),
          // A non-superseding start waits on the surface like a server-started
          // follow-up, so a thread's live run is refused as well.
          ...(supersedeLiveRun ? {} : { queuedSuccessor: true }),
        },
      );

      return toClientExecAgentResult(result);
    } catch (error: any) {
      console.error('execAgent failed: %O', error);

      if (error instanceof TRPCError) {
        throw error;
      }

      // A send that must not interrupt found the topic owned by a live run;
      // nothing was written, so the caller can queue it behind that run.
      if (!supersedeLiveRun && error instanceof TopicStartReservationError) {
        throw new TRPCError({
          cause: error,
          code: 'CONFLICT',
          message: 'The conversation is busy with a running turn; queue the message behind it.',
        });
      }

      // Another member's run drives the topic; a send never interrupts it, and
      // nothing was written.
      if (error instanceof ForeignLiveRunError) {
        throw new TRPCError({
          cause: error,
          code: 'CONFLICT',
          message: 'Another member is running this conversation; wait until their turn finishes.',
        });
      }

      // A device the caller required would be dropped by the agent's fixed
      // execution target; nothing was written.
      if (error instanceof RequestedDeviceIgnoredError) {
        throw new TRPCError({ cause: error, code: 'PRECONDITION_FAILED', message: error.message });
      }

      // An agent → agent send past the relay bound: the sending agent has to
      // hand back to a person, so the reason travels to it verbatim.
      if (error instanceof AgentRelayHopLimitError) {
        throw new TRPCError({ cause: error, code: 'TOO_MANY_REQUESTS', message: error.message });
      }

      if (error instanceof HumanApprovalAlreadyResolvedError) {
        throw new TRPCError({
          cause: error,
          code: 'CONFLICT',
          message: 'This approval has already been resolved.',
        });
      }

      // A primary-key collision on a client-supplied id (a retried send
      // replaying the same `clientIds`) is client-correctable — surface it as
      // CONFLICT, not a 500. Generic message on purpose: echoing the id would
      // let a caller probe for rows it cannot read.
      if (unwrapPgError(error)?.code === '23505') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This run has already been created.',
        });
      }

      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to execute agent: ${error.message}`,
      });
    }
  }),
  /**
   * Defer an agent run to a future time ("send this in 3 hours").
   *
   * Kept separate from `execAgent` rather than folded in behind a `runAt` flag:
   * nothing is executed here, so every run-shaped field of `ExecAgentResult`
   * (operationId, assistantMessageId, autoStarted) would come back empty and
   * every caller would have to branch on it.
   *
   * Cancelling / rescheduling goes through the ordinary topic update mutations —
   * those are already ownership-scoped, and a schedule is just topic state.
   */
  scheduleAgentRun: aiAgentWriteProcedure
    .input(ScheduleAgentRunSchema)
    .mutation(async ({ input, ctx }) => {
      log('scheduleAgentRun: identifier=%s, runAt=%s', input.agentId || input.slug, input.runAt);

      try {
        await assertCanUseWorkspaceAgent({
          agentId: input.agentId,
          db: ctx.serverDB,
          slug: input.slug,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        return await ctx.aiAgentService.scheduleAgentRun(input);
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to schedule agent run: ${error.message}`,
        });
      }
    }),
  /**
   * Batch execute multiple agents
   * Supports parallel or sequential execution
   */
  execAgents: aiAgentWriteProcedure.input(ExecAgentsSchema).mutation(async ({ input, ctx }) => {
    const { tasks, parallel = true } = input;

    log('execAgents: %d tasks, parallel=%s', tasks.length, parallel);

    type TaskResult = {
      autoStarted?: boolean;
      error?: string;
      operationId?: string;
      success: boolean;
      taskIndex: number;
    };

    const executeTask = async (
      task: (typeof tasks)[number],
      taskIndex: number,
    ): Promise<TaskResult> => {
      const {
        agentId,
        slug,
        prompt,
        appContext,
        autoStart = true,
        deviceId,
        existingMessageIds = [],
        parentMessageId,
        trigger,
      } = task;

      try {
        await assertCanUseWorkspaceAgent({
          agentId,
          db: ctx.serverDB,
          groupId: appContext?.groupId,
          slug,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        await assertCanUseAgentRunConversation({
          db: ctx.serverDB,
          messageIds: [
            ...existingMessageIds,
            parentMessageId,
            task.resumeApproval?.parentMessageId,
            task.resumeToolResult?.parentMessageId,
          ],
          topicId: appContext?.topicId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        const result = await ctx.aiAgentService.execAgent({
          acceptsFileWorks: acceptsFileWorksOf(task.streamFeatures),
          acceptsMemberRuntimeEnd: acceptsMemberRuntimeEndOf(task.streamFeatures),
          clientProtocol: task.clientProtocol,
          includeFinalState: task.includeFinalState,
          llmExecutor: task.llmExecutor,
          agentId,
          appContext,
          autoStart,
          deviceId,
          existingMessageIds,
          parentMessageId,
          prompt,
          // When parentMessageId is provided, this is a regeneration/continue — skip user message creation
          resume: !!parentMessageId,
          // NOTICE: the batch route forwards only a subset of `ExecAgentSchema`;
          // other per-turn picks (`selectedToolIds`, `mentionedAgents`, `fileIds`)
          // are still dropped here, as before this field was added.
          selectedSkillIds: task.selectedSkillIds,
          slug,
          trigger: trigger ?? RequestTrigger.Chat,
          // The user message's own content (rich text, attached content), with
          // the deprecated top-level selections folded in like the single route.
          userMessage: foldLegacyUserMessageFields(task).userMessage,
        });

        return {
          autoStarted: result.autoStarted,
          operationId: result.operationId,
          success: true,
          taskIndex,
        };
      } catch (error: any) {
        log('execAgents task %d failed: %O', taskIndex, error);

        return {
          error: error.message || 'Unknown error',
          success: false,
          taskIndex,
        };
      }
    };

    // Execute tasks with pMap for concurrency control
    // parallel=true: concurrency of 5, parallel=false: sequential (concurrency of 1)
    const concurrency = parallel ? 5 : 1;

    const results = await pMap(tasks, (task, index) => executeTask(task, index), { concurrency });

    // Calculate summary
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      results,
      success: failed === 0,
      summary: {
        failed,
        succeeded,
        total: tasks.length,
      },
    };
  }),
  /**
   * Execute Group Agent (Supervisor) in a single call
   *
   * This endpoint combines message creation and agent execution:
   * 1. Create topic (if needed)
   * 2. Create user message
   * 3. Create assistant message placeholder
   * 4. Trigger Supervisor Agent execution
   * 5. Return operationId for SSE connection + messages for UI sync
   */
  execGroupAgent: aiAgentWriteProcedure
    .input(ExecGroupAgentSchema)
    .mutation(async ({ input, ctx }) => {
      const { agentId, groupId, message, files, topicId, newTopic } = input;

      log('execGroupAgent: agentId=%s, groupId=%s', agentId, groupId);

      try {
        await assertCanUseWorkspaceAgent({
          agentId,
          db: ctx.serverDB,
          groupId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        await assertCanUseAgentRunConversation({
          db: ctx.serverDB,
          messageIds: newTopic?.topicMessageIds,
          topicId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        // Execute group agent
        const result = await ctx.aiAgentService.execGroupAgent({
          agentId,
          files,
          groupId,
          message,
          newTopic,
          topicId,
        });

        // Get messages and topics for UI sync
        // Messages include the assistant message with error if operation failed to start
        const { messages, topics } = await ctx.aiChatService.getMessagesAndTopics({
          agentId,
          groupId,
          includeTopic: result.isCreateNewTopic,
          topicId: result.topicId,
        });

        // Return result with messages/topics - includes error/success fields
        // Frontend can check success to decide whether to connect to SSE stream
        return { ...result, messages, topics };
      } catch (error: any) {
        log('execGroupAgent failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to execute group agent: ${error.message}`,
        });
      }
    }),
  /**
   * Execute SubAgent task (supports both Group and Single Agent mode)
   *
   * This endpoint is called by Supervisor (Group mode) or Agent (Single mode)
   * to delegate tasks to SubAgents. Each task runs in an isolated Thread context.
   *
   * - Group mode: pass groupId, Thread will be associated with the Group
   * - Single Agent mode: omit groupId, Thread will only be associated with the Agent
   */
  execSubAgentTask: aiAgentWriteProcedure
    .input(ExecSubAgentTaskSchema)
    .mutation(async ({ input, ctx }) => {
      const {
        agentId,
        groupId,
        instruction,
        llmExecutor,
        llmRelayChannel,
        parentMessageId,
        parentOperationId,
        title,
        topicId,
        timeout,
      } = input;

      log('execSubAgentTask: agentId=%s, groupId=%s', agentId, groupId);

      try {
        await assertCanUseWorkspaceAgent({
          agentId,
          db: ctx.serverDB,
          groupId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });
        await assertCanUseAgentRunConversation({
          db: ctx.serverDB,
          messageIds: [parentMessageId],
          topicId,
          userId: ctx.userId,
          workspaceId: ctx.workspaceId,
        });

        // External procedure name stays `execSubAgentTask`; the service method is `execSubAgent`.
        return await ctx.aiAgentService.execSubAgent(
          {
            agentId,
            groupId,
            instruction,
            parentMessageId,
            ...(parentOperationId && { parentOperationId }),
            timeout,
            title,
            topicId,
          },
          {
            llmRelay:
              llmExecutor && llmRelayChannel
                ? { channel: llmRelayChannel, executor: llmExecutor }
                : undefined,
          },
        );
      } catch (error: any) {
        log('execSubAgentTask failed: %O', error);

        if (error instanceof TRPCError) {
          throw error;
        }

        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to execute sub-agent task: ${error.message}`,
        });
      }
    }),
});
