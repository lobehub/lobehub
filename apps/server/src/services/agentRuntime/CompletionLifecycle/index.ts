import debug from 'debug';

import {
  AgentOperationModel,
  type RecordOperationStartParams,
} from '@/database/models/agentOperation';
import { MessageModel } from '@/database/models/message';
import { VerifyRunModel } from '@/database/models/verifyRun';
import type { LobeChatDatabase } from '@/database/type';
import { formatErrorForState } from '@/server/modules/AgentRuntime/formatErrorForState';
import {
  instantiateVerifyPlanOnStart,
  runVerifyOnCompletion,
  settleFailedRepair,
} from '@/server/services/verify';
import { after } from '@/server/utils/scheduleAfterResponse';

import { CriticalHookDeliveryError, hookDispatcher } from '../hooks';
import { recoverLastAssistantContent, resolveErrorMessageId } from './assistantMessage';
import { registerFileWorks } from './fileWorks';
import {
  CriticalAgentInterventionPersistenceError,
  notifyPendingAgentIntervention,
} from './intervention';
import { buildLifecycleEvent, extractErrorMessage } from './lifecycleEvent';
import { extractOutboundAttachments, extractTextFromMessageContent } from './messageContent';
import { persistCompletion } from './persistence';
import { recallUserOnCompletion } from './recall';
import { emitSignalEvents, isAgentShareRun } from './signals';
import type {
  CompleteOperationOptions,
  CompletionLifecycleDeps,
  OperationCompletionInput,
  SignalEvent,
  TopicRunSettledHandler,
} from './types';

export { CriticalAgentInterventionPersistenceError } from './intervention';
export {
  extractTextFromMessage,
  extractTextFromMessageContent,
  findLastAssistantMessage,
  normalizeCompletionMessages,
} from './messageContent';
export { isAgentShareRun } from './signals';
export type {
  CompleteOperationOptions,
  OperationCompletionInput,
  TopicRunSettledHandler,
} from './types';

const log = debug('lobe-server:completion-lifecycle');

/**
 * Terminal reasons this lifecycle treats as a successful completion: the run
 * produced a deliverable, even when it was stopped by a step/cost cap rather
 * than finishing naturally. `persistCompletion` stores all three with
 * status='done', and success-side effects (assistant-content recovery,
 * file-Work registration) must cover the capped reasons too — gating them on
 * `reason === 'done'` alone silently drops capped runs' artifacts.
 */
/** Terminal reasons after which the topic's agent may be woken again. */
const isTopicRunSettledReason = (reason: string) =>
  reason !== 'interrupted' && reason !== 'waiting_for_human' && reason !== 'waiting_for_async_tool';

export const isSuccessLikeCompletionReason = (reason: string): boolean =>
  reason === 'done' ||
  reason === 'max_steps' ||
  reason === 'cost_limit' ||
  reason === 'tool_call_repeat_limit';

/**
 * Owns everything that happens once an operation reaches a terminal state:
 * building the lifecycle event payload, emitting completion AgentSignal source
 * events, dispatching `onComplete`/`onError` hooks, and writing the final
 * error back onto the assistant message row.
 *
 * Ordinary side-effect errors are logged and remain non-fatal. Critical
 * no-fallback webhook failures are rethrown after terminal persistence so a
 * queue execution can retry the control-flow handoff.
 */
export class CompletionLifecycle {
  private readonly messageModel: MessageModel;
  private readonly agentOperationModel: AgentOperationModel;
  private readonly workspaceId?: string;
  /**
   * In-flight verify-plan instantiations started in {@link recordStart}, keyed by
   * operationId. `dispatchHooks` awaits the matching one before running the
   * completion gate so a very short / no-op task run can't race past its own plan
   * (instantiation is fire-and-forget at start and may not have settled yet).
   */
  private readonly verifyPlanInstantiations = new Map<string, Promise<void>>();
  private readonly onTopicRunSettled?: TopicRunSettledHandler;

  constructor(
    private readonly serverDB: LobeChatDatabase,
    private readonly userId: string,
    workspaceId?: string,
    options?: {
      /**
       * Opt IN to agent-share visitor rows on this service's `messageModel`.
       * Reserved for share-runtime callers driving a visitor turn under the
       * creator's identity.
       */
      includeShareVisitor?: boolean;
      /** See {@link TopicRunSettledHandler}. */
      onTopicRunSettled?: TopicRunSettledHandler;
    },
  ) {
    this.workspaceId = workspaceId;
    this.includeShareVisitor = options?.includeShareVisitor ?? false;
    this.onTopicRunSettled = options?.onTopicRunSettled;
    this.messageModel = new MessageModel(serverDB, userId, workspaceId, undefined, {
      includeShareVisitor: this.includeShareVisitor,
    });
    this.agentOperationModel = new AgentOperationModel(serverDB, userId, workspaceId);
  }

  private readonly includeShareVisitor: boolean;

  /**
   * The instance state the extracted completion steps read. Built per call so
   * the steps always see the current models.
   */
  private deps(): CompletionLifecycleDeps {
    return {
      agentOperationModel: this.agentOperationModel,
      includeShareVisitor: this.includeShareVisitor,
      messageModel: this.messageModel,
      serverDB: this.serverDB,
      userId: this.userId,
      workspaceId: this.workspaceId,
    };
  }

  /**
   * Persist the initial `agent_operations` row when an operation is created.
   * Returns whether the row write succeeded so security-sensitive callers can
   * require durable state before dispatch. Other runtime paths may preserve
   * the historical non-blocking behavior by ignoring the result.
   */
  async recordStart(params: RecordOperationStartParams): Promise<boolean> {
    let persisted = true;
    try {
      await this.agentOperationModel.recordStart(params);
    } catch (error) {
      persisted = false;
      // Hook configuration may contain inline authorization headers. Never log
      // a database error that could repeat its bound metadata parameters.
      const hooks = params.metadata?._hooks;
      if (hooks && (!Array.isArray(hooks) || hooks.length > 0))
        log('[%s] Failed to record operation start (non-fatal)', params.operationId);
      else log('[%s] Failed to record operation start (non-fatal): %O', params.operationId, error);
    }

    // Auto-instantiate the task's verify plan at run start so the completion gate
    // fires. Only for a top-level task operation — repair / verifier sub-agents
    // (which carry a parentOperationId) get their plan from the repair path, not
    // here. Fire-and-forget; never blocks startup. We keep the promise (instead of
    // void-ing it) so `dispatchHooks` can await it before the completion gate runs
    // — a fast run can otherwise complete first and the gate would no-op on a plan
    // that lands moments later. (instantiateVerifyPlanOnStart never rejects.)
    if (params.taskId && !params.parentOperationId) {
      this.verifyPlanInstantiations.set(
        params.operationId,
        instantiateVerifyPlanOnStart(
          this.serverDB,
          this.userId,
          { operationId: params.operationId, taskId: params.taskId },
          this.workspaceId,
        ),
      );
    }

    return persisted;
  }

  /**
   * Persist terminal state to `agent_operations`. Fire-and-forget: a DB
   * outage must never block hook dispatch or the executor's terminal
   * cleanup path.
   */
  private async persistCompletion(
    operationId: string,
    state: any,
    reason: string,
    settledAsAbandoned?: boolean,
  ): Promise<boolean> {
    return persistCompletion(this.deps(), operationId, state, reason, settledAsAbandoned);
  }

  /**
   * Extract a human-readable error message from the agent state error object.
   * Handles both raw `ChatCompletionErrorPayload` (from runtime.step catch) and
   * formatted `ChatMessageError` (from executeStep catch).
   *
   * Public so callers can use the same formatting when surfacing errors
   * outside the hook dispatch path (e.g. trace snapshot finalize).
   */
  extractErrorMessage(error: any): string | undefined {
    return extractErrorMessage(error);
  }

  /**
   * Emit completion AgentSignal source events and return compact snapshot
   * events for attachment to the trace step. Fire-and-forget.
   */
  async emitSignalEvents(operationId: string, state: any, reason: string): Promise<SignalEvent[]> {
    return emitSignalEvents(this.deps(), operationId, state, reason);
  }

  /**
   * Insert a `role='verify'` message that renders the Agent Run delivery-checker
   * card (plan + results, read off `metadata.verifyOperationId`). Only created
   * when the run actually has a verify plan. Self-guarded — failures never affect
   * the run; the card is purely additive UI.
   */
  private async createVerifyMessage(
    operationId: string,
    assistantMessageId: string | undefined,
    userId: string,
  ): Promise<void> {
    try {
      const run = await new VerifyRunModel(this.serverDB, userId).findByOperation(operationId);
      if (!run?.plan?.length) return;

      const op = await new AgentOperationModel(this.serverDB, userId).findById(operationId);
      if (!op?.topicId) return;

      const messageModel = new MessageModel(this.serverDB, userId, undefined, undefined, {
        includeShareVisitor: this.includeShareVisitor,
      });
      await messageModel.create({
        agentId: op.agentId ?? undefined,
        content: '',
        groupId: op.chatGroupId ?? undefined,
        metadata: { verifyOperationId: operationId },
        parentId: assistantMessageId,
        role: 'verify',
        threadId: op.threadId ?? undefined,
        topicId: op.topicId,
      });
    } catch (error) {
      log('createVerifyMessage failed for op %s (non-fatal): %O', operationId, error);
    }
  }

  /**
   * Expand a normalized {@link OperationCompletionInput} into the runtime `state`
   * shape `dispatchHooks` consumes. The SINGLE place that mirrors the runtime
   * state for non-in-process paths — goal/deliverable become the user/assistant
   * turns the gate reads, model/provider backfill the op row, hooks ride on
   * `host.hooks`. Replaces the per-caller hand-rolled synthetic state that
   * previously drifted (e.g. a verify field added here was missed by heteroFinish).
   */
  private buildStateFromInput(input: OperationCompletionInput) {
    return {
      cost: input.cost ?? { total: null },
      createdAt: input.startedAt,
      error: input.error ?? undefined,
      messages: [
        { content: input.goal ?? '', role: 'user' },
        { content: input.deliverable ?? '', role: 'assistant' },
      ],
      host: { hooks: input.serializedHooks },
      metadata: { assistantMessageId: input.assistantMessageId },
      origin: {
        agentId: input.agentId,
        lineage: { orchestrationRole: input.orchestrationRole },
        topicId: input.topicId,
        userId: input.userId ?? this.userId,
      },
      model: input.model ?? undefined,
      provider: input.provider ?? undefined,
      stepCount: input.stepCount ?? null,
      llmCalls: input.llmCalls ?? undefined,
      usage: input.usage ?? undefined,
    };
  }

  /**
   * Register the operation's Works (edited entity files plus github issue/PR
   * Works). Idempotent per state object; see `registerFileWorks` in
   * `./fileWorks` for the marker and retry contract.
   */
  async registerFileWorks(operationId: string, state: any): Promise<void> {
    return registerFileWorks(this.deps(), operationId, state);
  }

  /**
   * The single terminal-completion entry for every path that does NOT have the
   * in-process runtime's rich `state` in hand: heterogeneous CLI exit
   * (`heteroFinish`), remote-agent done signal (`agentNotify`), and synchronous
   * dispatch failure (`finalizeHeteroDispatchError`). Builds the synthetic state
   * once and runs the SAME pipeline the in-process runtime uses — persist the
   * terminal op row, fire onComplete/onError hooks, and (on `done`) run the
   * delivery-checker verify gate. This is what makes those paths true lifecycle
   * peers instead of firing a stripped-down hooks-only funnel.
   */
  async completeOperation(
    input: OperationCompletionInput,
    reason: 'done' | 'error' | 'interrupted',
    options?: CompleteOperationOptions,
  ): Promise<void> {
    await this.dispatchHooks(input.operationId, this.buildStateFromInput(input), reason, options);
  }

  /**
   * Dispatch `onComplete` (and `onError` for `reason='error'`) hooks via
   * the global `hookDispatcher`. On the error path, also writes the error
   * back onto the assistant message row so the frontend can render it.
   * Fire-and-forget; unregisters the operation after a settled lifecycle while
   * preserving registrations across retryable critical delivery failures.
   */
  async dispatchHooks(
    operationId: string,
    state: any,
    reason: string,
    options?: CompleteOperationOptions,
  ): Promise<void> {
    // `waiting_for_async_tool` parks the SAME operation: it persists the parked
    // status (the async-tool resume CAS reads it) but must NOT fire `onComplete`
    // or unregister hooks — the op resumes under this same id and reaches its
    // real terminal state later, which is when consumers should be notified.
    // `waiting_for_human` is different: the parked segment fires `onComplete`
    // so hook consumers can surface the approval request. A winning decision
    // schedules a fresh continuation operation and then retires this parked
    // segment; the continuation receives the serialized hooks through
    // `host.hooks`.
    // `waiting_for_client` (no client to run the next LLM call) parks the same
    // operation the same way: it resumes under this id or expires to `error`.
    const isAsyncToolPark = reason === 'waiting_for_async_tool' || reason === 'waiting_for_client';
    let shouldRetainHooksForRetry = false;

    try {
      const {
        assistantMessageId,
        event,
        metadata,
        origin: runOrigin,
      } = this.buildLifecycleEvent(operationId, state, reason);

      // Finalize the agent_operations row before user hooks fire so
      // downstream consumers see the row in its terminal shape.
      const completionAccepted = await this.persistCompletion(
        operationId,
        state,
        reason,
        options?.settledAsAbandoned,
      );
      if (completionAccepted === false) {
        log('[%s] Skipping hooks for an operation with a conflicting terminal owner', operationId);
        return;
      }

      // At this point the parked operation state has been durably projected to
      // agent_operations. Verify the tool rows independently before creating a
      // durable Review so a partial batch can never reach notification UI.
      if (reason === 'waiting_for_human') {
        await this.notifyPendingAgentIntervention(operationId, state);
      }

      if (isAsyncToolPark) return;

      // `lastAssistantContent` comes off the Redis-backed `state.messages`,
      // while the assistant message row is persisted through a separate
      // `messageModel.update` path. When the two diverge (state entry empty
      // but the DB row holds the full reply — Discord bot completions
      // arrived with no content while the app showed the reply), consumers
      // like the IM bot callback silently drop the reply. Recover from the DB
      // row — the same source of truth the app UI renders — before dispatch.
      if (
        isSuccessLikeCompletionReason(reason) &&
        !event.lastAssistantContent?.trim() &&
        !event.attachments?.length
      ) {
        const recovered = await this.recoverLastAssistantContent(
          operationId,
          assistantMessageId,
          runOrigin.userId || this.userId,
          typeof runOrigin.topicId === 'string' ? runOrigin.topicId : undefined,
        );
        if (recovered) {
          event.lastAssistantContent = recovered;
          const attachments = extractOutboundAttachments([
            { content: recovered, role: 'assistant' },
          ]);
          event.attachments = attachments.length > 0 ? attachments : undefined;
        }
      }

      await hookDispatcher.dispatch(operationId, 'onComplete', event, state?.host?.hooks);

      // Recall the user when a run finishes with a deliverable while they may be
      // away (push / inbox). Fires on every success-like terminal — `done` plus
      // the step/cost caps, which still produce a reply worth recalling — to
      // match the desktop completion notification, which notifies on any clean
      // (non-abort, non-error) terminal. Fire-and-forget through the
      // `@/business` slot; the default implementation is a no-op. Sub-agent /
      // group-member completions are internal steps of a parent run, never a
      // user-facing recall — in-group members carry `orchestrationRole: 'member'`
      // WITHOUT `isSubAgent` (see execAgentMember), so guard both. The
      // remaining condition — only interactive chat runs recall the user —
      // lives in recallUserOnCompletion.
      //
      // Agent Share visitor runs execute AS the creator, so this `userId`-scoped
      // recall would otherwise reach the creator's push/inbox for every turn an
      // arbitrary link visitor completes — a visitor could spam the owner by
      // repeatedly running the shared agent, and the notification would deep-link
      // into a visitor topic (`topics.senderId`) that is deliberately excluded
      // from creator-facing surfaces.
      if (
        isSuccessLikeCompletionReason(reason) &&
        runOrigin.lineage?.isSubAgent !== true &&
        runOrigin.lineage?.orchestrationRole !== 'member' &&
        !isAgentShareRun(state)
      ) {
        void this.recallUserOnCompletion(operationId, event, runOrigin).catch((error) =>
          log('[%s] Completion notification failed (non-fatal): %O', operationId, error),
        );
      }

      const settledTopicId = typeof runOrigin.topicId === 'string' ? runOrigin.topicId : undefined;
      if (
        this.onTopicRunSettled &&
        settledTopicId &&
        isTopicRunSettledReason(reason) &&
        !runOrigin.lineage?.parentOperationId &&
        runOrigin.lineage?.isSubAgent !== true &&
        runOrigin.lineage?.orchestrationRole !== 'member' &&
        !runOrigin.signal &&
        !isAgentShareRun(state)
      ) {
        const onTopicRunSettled = this.onTopicRunSettled;
        after(() => onTopicRunSettled({ operationId, topicId: settledTopicId }));
      }

      // Delivery checker: on a successful completion, run the confirmed verify
      // plan against the deliverable. Fire-and-forget and self-guarded — a run
      // without an opted-in plan is a no-op, and failures never affect the run.
      if (reason === 'done') {
        // The task's verify plan is instantiated fire-and-forget at run start; a
        // fast or no-op run can reach completion before it settles. Await the
        // in-flight instantiation (if any) so the gate sees the confirmed plan
        // instead of racing past it and leaving a planned run with no results/card.
        await this.verifyPlanInstantiations.get(operationId);

        const messages: any[] = Array.isArray(state?.messages) ? state.messages : [];
        const firstUserMessage = messages.find((m) => m?.role === 'user');
        const goal = firstUserMessage
          ? (extractTextFromMessageContent(firstUserMessage.content) ?? '')
          : '';
        // Surface the delivery-checker card first (a role='verify' message that
        // renders the run's plan + results). Awaited before verification so
        // auto-repair can persist its failure feedback onto this card (the
        // VerifyMessageProcessor then surfaces it into the repair run's context).
        // Self-guarded — failures never affect the run.
        await this.createVerifyMessage(
          operationId,
          metadata?.assistantMessageId,
          runOrigin.userId || this.userId,
        );
        // `after`, not a bare `void`: judging is minutes of LLM calls and the
        // step handler must not wait for it, but a detached promise has nobody
        // keeping it scheduled — on the serverless path the instance is free to
        // stop running it the moment this response returns. That is not merely a
        // lost verification: entering `verifying` is a durable write, so a run
        // cut off mid-judge stays `verifying` forever. `after` hands the work to
        // the host as post-response work instead (no-op fallback off Next).
        after(() =>
          runVerifyOnCompletion(
            this.serverDB,
            runOrigin.userId || this.userId,
            {
              deliverable: event.lastAssistantContent ?? '',
              goal,
              operationId,
            },
            this.workspaceId,
          ),
        );
      }

      if (reason === 'error' || reason === 'interrupted') {
        after(async () => {
          await settleFailedRepair(
            this.serverDB,
            runOrigin.userId || this.userId,
            operationId,
            this.workspaceId,
          );
        });
      }

      // Register entity files edited this round as `file` Works. On the
      // gateway/queue path this already ran BEFORE the terminal snapshot (see
      // `registerFileWorks`) and no-ops via the state marker; here it is the
      // backstop for every other terminal path (in-process runtime, hetero
      // completions, already-terminal early exits). Guarded on success-LIKE
      // reasons, not `done` alone: a run stopped by a step/cost cap still
      // produced its edits and persists as status='done'.
      //
      // `waiting_for_human` deliberately does NOT register: the park is not a
      // successful deliverable boundary. The fresh approval continuation is
      // built from the complete authoritative history and performs the real
      // terminal scan. Registering here would freeze pre-approval file content
      // as a completed Work before the user decision has run.
      if (isSuccessLikeCompletionReason(reason)) {
        await this.registerFileWorks(operationId, state);
      }

      if (reason === 'error') {
        await hookDispatcher.dispatch(operationId, 'onError', event, state?.host?.hooks);

        const assistantMessageId =
          state?.error && !options?.skipErrorMessageWrite
            ? await this.resolveErrorMessageId(operationId, metadata, runOrigin)
            : undefined;
        if (assistantMessageId && state?.error && !options?.skipErrorMessageWrite) {
          // Preserve the semantic error type written by the runtime. Rebuilding
          // this as a generic AgentRuntimeError would lose UI routing data such
          // as quota context and force the client into the fallback card.
          const messageError = formatErrorForState(state.error);
          const errorMessage =
            this.extractErrorMessage(messageError) ||
            this.extractErrorMessage(state.error) ||
            String(state.error);
          try {
            await this.messageModel.update(assistantMessageId, {
              error: {
                ...messageError,
                body: messageError.body ?? { message: errorMessage },
                message: errorMessage,
              },
            });
          } catch (updateError) {
            log(
              '[%s] Failed to update assistant message with error (non-fatal): %O',
              operationId,
              updateError,
            );
          }
        }
      }
    } catch (error) {
      if (
        error instanceof CriticalHookDeliveryError ||
        error instanceof CriticalAgentInterventionPersistenceError
      ) {
        // A queue retry may run in this same process (local callback / warm
        // worker). Keep the in-memory registration until that lifecycle really
        // settles; queue mode can additionally reconstruct from host.hooks.
        shouldRetainHooksForRetry = true;
        throw error;
      }
      log('[%s] Hook dispatch error (non-fatal): %O', operationId, error);
    } finally {
      // Keep hooks registered across an async-tool park so the eventual resume
      // (same operationId) can still fire onComplete/onError. Critical delivery
      // failures likewise keep them until the provider redelivery settles.
      if (!isAsyncToolPark && !shouldRetainHooksForRetry) {
        hookDispatcher.unregister(operationId);
        // The instantiation has settled (awaited above) or this op never opted in
        // — drop the entry so the map doesn't grow across the service's lifetime.
        // Kept across an async-tool park: the op resumes under the same id.
        this.verifyPlanInstantiations.delete(operationId);
      }
    }
  }

  private async notifyPendingAgentIntervention(operationId: string, state: any): Promise<void> {
    return notifyPendingAgentIntervention(this.deps(), operationId, state);
  }

  private async recallUserOnCompletion(
    operationId: string,
    event: { agentId?: string; duration?: number; lastAssistantContent?: string; topicId?: string },
    runOrigin: { trigger?: unknown; userId?: string } | undefined,
  ): Promise<void> {
    return recallUserOnCompletion(this.deps(), operationId, event, runOrigin);
  }

  private async recoverLastAssistantContent(
    operationId: string,
    assistantMessageId: string | undefined,
    userId: string,
    topicId?: string,
  ): Promise<string | undefined> {
    return recoverLastAssistantContent(
      this.deps(),
      operationId,
      assistantMessageId,
      userId,
      topicId,
    );
  }

  private async resolveErrorMessageId(
    operationId: string,
    metadata: { assistantMessageId?: string } | undefined,
    runOrigin: { topicId?: string; userId?: string },
  ): Promise<string | undefined> {
    return resolveErrorMessageId(this.deps(), operationId, metadata, runOrigin);
  }

  private buildLifecycleEvent(operationId: string, state: any, reason: string) {
    return buildLifecycleEvent(this.userId, operationId, state, reason);
  }
}
