import { RequestTrigger } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { z } from 'zod';

import { withScopedPermission } from '@/business/server/trpc-middlewares/rbacPermission';
import { wsCompatProcedure } from '@/business/server/trpc-middlewares/workspaceAuth';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { TopicModel } from '@/database/models/topic';
import { router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { createStreamEventManager } from '@/server/modules/AgentRuntime/factory';
import { CompletionLifecycle } from '@/server/services/agentRuntime/CompletionLifecycle';
import type { SerializedHook } from '@/server/services/agentRuntime/hooks/types';
import { AiAgentService } from '@/server/services/aiAgent';
import { instantiateVerifyPlanOnStart } from '@/server/services/verify';

// Module-level singleton so we don't create a new Redis connection per request.
let _streamManager: ReturnType<typeof createStreamEventManager> | undefined;
const getStreamManager = () => {
  if (!_streamManager) _streamManager = createStreamEventManager();
  return _streamManager;
};

const log = debug('lobe-server:agent-notify-router');

const agentNotifyProcedure = wsCompatProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;
  const wsId = ctx.workspaceId ?? undefined;

  return opts.next({
    ctx: {
      aiAgentService: new AiAgentService(ctx.serverDB, ctx.userId, { workspaceId: wsId }),
      messageModel: new MessageModel(ctx.serverDB, ctx.userId, wsId),
      topicModel: new TopicModel(ctx.serverDB, ctx.userId, wsId),
    },
  });
});
const agentNotifyWriteProcedure = agentNotifyProcedure.use(withScopedPermission('message:create'));

const NotifySchema = z.object({
  /** Agent ID to trigger (overrides the topic's default agent) */
  agentId: z.string().optional(),
  /** Message content from the external agent */
  content: z.string(),
  /**
   * When role is 'assistant': whether to trigger a new agent turn after writing
   * the assistant message. Defaults to false.
   */
  continue: z.boolean().optional(),
  /**
   * Signal that the remote hetero agent (openclaw / hermes) has finished its
   * task. When true, the server publishes `agent_runtime_end` to the stream event
   * manager so the frontend's gateway WS subscription closes cleanly.
   * Can be combined with content (final message + done) or sent alone (just done).
   */
  done: z.boolean().optional(),
  /**
   * Terminal error for a remote hetero run (openclaw / hermes). The notify
   * channel otherwise only carries success, so a remote agent that crashes /
   * fails has no way to fail its run. When present the run is finalized as
   * FAILED instead of succeeded — `agent_runtime_end` carries `reason='error'`
   * and the onError/onComplete hooks fire with this message, so the owning task
   * is marked failed and any IM bot callback renders the error. Implies a
   * terminal signal (treated like `done: true`).
   */
  error: z.object({ message: z.string(), type: z.string().optional() }).optional(),
  /**
   * When role is 'assistant': update an existing message instead of creating a
   * new one. The caller is responsible for passing the messageId returned by the
   * first notify call. Subsequent calls with this id will overwrite the content
   * in-place, keeping a single bubble in the UI.
   */
  messageId: z.string().optional(),
  /**
   * Role of the message to write:
   * - 'user' (default): write as user message and trigger the agent to reply
   * - 'assistant': write directly as assistant message without an extra LLM call
   */
  role: z.enum(['assistant', 'user']).optional(),
  /** Thread ID for threaded conversations */
  threadId: z.string().optional(),
  /** Topic ID to send the message to */
  topicId: z.string(),
});

export const agentNotifyRouter = router({
  /**
   * Receive a callback message from an external agent (e.g. Claude Code),
   * write it into a topic, and optionally trigger the agent loop.
   *
   * role='user' (default): content becomes a user message → agent replies
   * role='assistant': content is written directly as an assistant message
   *   continue=true: also trigger a new agent turn after writing
   */
  notify: agentNotifyWriteProcedure.input(NotifySchema).mutation(async ({ input, ctx }) => {
    const {
      topicId,
      content,
      agentId: inputAgentId,
      threadId,
      role = 'user',
      continue: shouldContinue = false,
      done = false,
      error: terminalError,
      messageId,
    } = input;

    // An error is itself a terminal signal — finalize the run even if the
    // remote agent didn't also set `done`.
    const isTerminal = done || !!terminalError;

    log(
      'notify: topicId=%s, agentId=%s, role=%s, continue=%s, done=%s, messageId=%s, content=%s',
      topicId,
      inputAgentId,
      role,
      shouldContinue,
      done,
      messageId,
      content.slice(0, 80),
    );

    // 1. Verify the topic exists and get its agentId + running operationId
    const topic = await ctx.topicModel.findById(topicId);
    if (!topic) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Topic ${topicId} not found`,
      });
    }

    // Extract the operationId seeded by execAgent for remote hetero agents.
    // Used to publish notify_update / agent_runtime_end events to the gateway WS.
    const remoteOperationId = (topic.metadata as any)?.runningOperation?.operationId as
      string | undefined;

    const agentId = inputAgentId ?? topic.agentId;
    if (!agentId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Topic ${topicId} has no associated agent and no agentId was provided`,
      });
    }

    /**
     * Publish a stream event for remote hetero agents (openclaw / hermes).
     * Fire-and-forget — stream publish failures must not break the notify response.
     */
    const publishRemoteHeteroEvent = async (writtenMessageId?: string) => {
      if (!remoteOperationId) return;
      try {
        const stream = getStreamManager();
        if (isTerminal) {
          // Signal task completion — frontend gateway WS subscription closes.
          // A `terminalError` finalizes the run as failed; otherwise it succeeded.
          await stream.publishAgentRuntimeEnd({
            finalState: terminalError
              ? { error: terminalError.message, reason: 'error' }
              : { reason: 'success' },
            operationId: remoteOperationId,
            reason: terminalError ? 'error' : 'success',
            reasonDetail: terminalError?.message ?? 'Remote hetero agent task completed',
            stepIndex: 0,
          });

          // Remote hetero (openclaw / hermes) has no `heteroFinish` callback, so
          // this is its terminal funnel. Route it through CompletionLifecycle's
          // single entry — the SAME owner the CLI / in-process paths use — so
          // persistCompletion writes the terminal op row, onComplete/onError hooks
          // fire (task lifecycle → task done/failed + IM bot callback), and on
          // success the delivery-checker verify gate runs against the task's plan.
          // (Previously this fired the stripped-down dispatchTerminalHooks, which
          // skipped persist + verify — so openclaw/hermes tasks never auto-verified.)
          // Hooks were serialized onto runningOperation at dispatch time.
          const serializedHooks = (topic.metadata as any)?.runningOperation?.hooks as
            SerializedHook[] | undefined;
          let lastAssistantContent: string | undefined = content || undefined;
          if (!lastAssistantContent && writtenMessageId) {
            const msg = await ctx.messageModel.findById(writtenMessageId).catch(() => undefined);
            lastAssistantContent = (msg?.content as string | undefined) ?? undefined;
          }
          // Mirror heteroFinish's done-path prep (this is the openclaw/hermes
          // equivalent terminal funnel). Skipped on the error path (verify is
          // done-only). Each step is self-guarded so a failure degrades instead
          // of aborting the terminal funnel.
          let goal: unknown = '';
          if (!terminalError) {
            // Guarantee the task's verify plan is DURABLY persisted before the gate
            // (completeOperation → runVerifyOnCompletion) reads it. The start-side
            // instantiation in execAgent is fire-and-forget on a SEPARATE
            // CompletionLifecycle instance, so its in-memory await can't bridge to
            // THIS notify request — a fast remote task could otherwise reach the
            // gate before the plan lands and silently skip verify (and the
            // verify-bound task deferral). instantiateVerifyPlanOnStart is
            // idempotent, so awaiting it here creates the plan only when the start
            // side hasn't yet, and is a no-op once it has.
            try {
              const op = await new AgentOperationModel(
                ctx.serverDB,
                ctx.userId,
                ctx.workspaceId ?? undefined,
              ).findById(remoteOperationId);
              if (op?.taskId && !op.parentOperationId) {
                await instantiateVerifyPlanOnStart(
                  ctx.serverDB,
                  ctx.userId,
                  { operationId: remoteOperationId, taskId: op.taskId },
                  ctx.workspaceId ?? undefined,
                );
              }
            } catch (err) {
              log('notify: ensure verify plan failed (non-fatal): %O', err);
            }
            // Resolve the run goal (first user turn) — the verify gate judges the
            // deliverable against it. Wrapped in try/catch (not just a promise
            // `.catch`) so a throwing/absent query degrades to an empty goal.
            try {
              const history = await ctx.messageModel.query({ pageSize: 50, topicId });
              goal = history.find((m) => m.role === 'user')?.content ?? '';
            } catch (err) {
              log('notify: failed to resolve verify goal (non-fatal): %O', err);
            }
          }
          await new CompletionLifecycle(
            ctx.serverDB,
            ctx.userId,
            ctx.workspaceId ?? undefined,
          ).completeOperation(
            {
              agentId,
              assistantMessageId: writtenMessageId,
              deliverable: lastAssistantContent,
              error: terminalError ?? undefined,
              goal,
              operationId: remoteOperationId,
              serializedHooks,
              topicId,
              userId: ctx.userId,
            },
            terminalError ? 'error' : 'done',
            // openclaw/hermes surface their failure via the runtime-end stream event
            // + their own message write, not the lifecycle's assistant-row error
            // write — keep that prior behavior on the error path.
            { skipErrorMessageWrite: true },
          );

          // The operation is finished — drop the running marker so a duplicate
          // terminal signal / reconnect doesn't re-fire the hooks.
          await ctx.topicModel.updateMetadata(topicId, { runningOperation: null }).catch(() => {});
        } else {
          // Lightweight invalidation — frontend calls fetchAndReplaceMessages.
          await stream.publishStreamEvent(remoteOperationId, {
            data: { messageId: writtenMessageId },
            stepIndex: 0,
            type: 'notify_update',
          });
        }
      } catch (err) {
        log(
          'notify: failed to publish stream event for operationId=%s: %O',
          remoteOperationId,
          err,
        );
      }
    };

    // 2a. Assistant mode: write message directly without triggering LLM
    if (role === 'assistant') {
      try {
        // Resolve the target message ID:
        // 1. Caller-supplied messageId (subsequent notify calls with --message-id)
        // 2. Placeholder assistantMessageId seeded by execAgent (first notify call for remote hetero)
        // Using the placeholder avoids creating a second empty bubble in the UI.
        const placeholderMessageId = (topic.metadata as any)?.runningOperation
          ?.assistantMessageId as string | undefined;
        const resolvedMessageId = messageId ?? placeholderMessageId;

        // Update existing message if we have a resolved target
        if (resolvedMessageId) {
          // Security: verify the message belongs to this topic before writing.
          // MessageModel.update scopes only by userId; without this check, a remote
          // runtime could overwrite messages from other conversations.
          const existingMsg = await ctx.messageModel.findById(resolvedMessageId);
          if (!existingMsg || existingMsg.topicId !== topicId) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'Message does not belong to this topic',
            });
          }

          // Terminal signal (done or error) with empty content + existing
          // placeholder → just finalize the run, no message update. Pass the
          // resolved id so the finalizer can reload the agent's final reply
          // (written in-place via earlier `lh notify` calls) into
          // `lastAssistantContent` — bot completion callbacks and the task
          // lifecycle follow-ups (handoff / auto-review / brief) depend on it.
          if (isTerminal && !content) {
            void publishRemoteHeteroEvent(resolvedMessageId);
            return { messageId: resolvedMessageId, operationId: undefined, topicId };
          }
          await ctx.messageModel.update(resolvedMessageId, { content });
          void publishRemoteHeteroEvent(resolvedMessageId);
          if (shouldContinue) {
            const result = await ctx.aiAgentService.execAgent({
              agentId,
              appContext: { threadId, topicId },
              parentMessageId: resolvedMessageId,
              prompt: '',
              resume: true,
              trigger: RequestTrigger.Notify,
            });
            return { messageId: resolvedMessageId, operationId: result.operationId, topicId };
          }
          return { messageId: resolvedMessageId, operationId: undefined, topicId };
        }

        // Terminal signal (done or error) with no messageId and empty content →
        // just finalize the run, no DB write.
        if (isTerminal && !content) {
          void publishRemoteHeteroEvent();
          return { messageId: undefined, operationId: undefined, topicId };
        }

        const msg = await ctx.messageModel.create({
          agentId,
          content,
          role: 'assistant',
          threadId: threadId ?? undefined,
          topicId,
        });

        void publishRemoteHeteroEvent(msg.id);

        // Optionally trigger a follow-up agent turn.
        // Use resume=true + parentMessageId so execAgent skips creating an
        // empty user message (effectiveResume=true bypasses that branch).
        if (shouldContinue) {
          const result = await ctx.aiAgentService.execAgent({
            agentId,
            appContext: { threadId, topicId },
            parentMessageId: msg.id,
            prompt: '',
            resume: true,
            trigger: RequestTrigger.Notify,
          });

          return {
            messageId: msg.id,
            operationId: result.operationId,
            topicId,
          };
        }

        return { messageId: msg.id, operationId: undefined, topicId };
      } catch (error: any) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          cause: error,
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to write assistant message: ${error.message}`,
        });
      }
    }

    // 2b. User mode (default): trigger the agent loop
    try {
      const result = await ctx.aiAgentService.execAgent({
        agentId,
        appContext: { threadId, topicId },
        prompt: content,
        trigger: RequestTrigger.Notify,
      });

      return {
        operationId: result.operationId,
        topicId,
      };
    } catch (error: any) {
      console.error('agentNotify execAgent failed: %O', error);

      if (error instanceof TRPCError) {
        throw error;
      }

      throw new TRPCError({
        cause: error,
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to trigger agent: ${error.message}`,
      });
    }
  }),
});
