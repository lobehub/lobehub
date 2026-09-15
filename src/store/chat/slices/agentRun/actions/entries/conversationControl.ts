// Disable the auto sort key eslint rule to make the code more logic and readable
import { type AgentRuntimeContext } from '@lobechat/agent-runtime';
import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import {
  type ChatTopicStatus,
  type ConversationContext,
  type MessageMetadata,
  type UIChatMessage,
} from '@lobechat/types';
import { t } from 'i18next';

import { type ChatInputEditor } from '@/features/ChatInput';
import { lambdaClient } from '@/libs/trpc/client';
import {
  type AgentInterventionSourceAction,
  aiAgentService,
  type ResolveAgentInterventionBySourceResult,
} from '@/services/aiAgent';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { displayMessageSelectors } from '@/store/chat/selectors';
import {
  type AgentRuntimeType,
  selectRuntimeType,
} from '@/store/chat/slices/agentRun/actions/dispatch/agentDispatcher';
import { type OptimisticUpdateContext } from '@/store/chat/slices/message/actions/optimisticUpdate';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import type { Operation } from '@/store/chat/slices/operation/types';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import { type ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { type StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';

import { buildRunLifecycle } from '../lifecycle/buildRunLifecycle';
import { type RunScope } from '../lifecycle/types';

/**
 * Actions for controlling conversation operations like cancellation and error handling
 */

type Setter = StoreSetter<ChatStore>;

const canonicalizeResolutionPayload = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeResolutionPayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalizeResolutionPayload(child)]),
    );
  }
  return value;
};

const toAgentInterventionAnswerResult = (
  value: Record<string, unknown>,
): Record<string, string | string[]> | undefined => {
  const entries = Object.entries(value);
  if (
    entries.length === 0 ||
    entries.some(
      ([, answer]) =>
        typeof answer !== 'string' &&
        !(Array.isArray(answer) && answer.every((item) => typeof item === 'string')),
    )
  ) {
    return;
  }
  return Object.fromEntries(entries) as Record<string, string | string[]>;
};

const toHeterogeneousSourceAction = (
  actionType: 'submit' | 'skip' | 'cancel',
  interactionKind: unknown,
  payload: Record<string, unknown>,
): AgentInterventionSourceAction | undefined => {
  if (actionType === 'skip') return { type: 'skip_interaction' };
  if (actionType === 'cancel') return { type: 'cancel_interaction' };

  if (interactionKind === 'question') {
    const result = toAgentInterventionAnswerResult(payload);
    return result ? { result, type: 'submit_answers' } : undefined;
  }
  if (interactionKind === 'permission' || interactionKind === 'plan') {
    const selected = Object.values(payload).flatMap((value) =>
      typeof value === 'string'
        ? [value]
        : Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : [],
    );
    return selected.length === 1
      ? { optionId: selected[0], type: 'select_provider_option' }
      : undefined;
  }
};

export const conversationControl = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ConversationControlActionImpl(set, get, _api);

export class ConversationControlActionImpl {
  readonly #get: () => ChatStore;
  /** Stable generic claim key shared by retries of one active Web action. */
  readonly #interventionResolutionRequestIds = new Map<string, string>();
  /** Stable per-intervention idempotency key reused by transport retries. */
  readonly #heteroResolutionRequestIds = new Map<string, string>();

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  /**
   * Resolve an active Gateway card through the same durable generic claim as
   * Mobile/notifications. Returns false only when the deployment has no
   * generic intervention store, allowing the existing OSS path to continue.
   */
  tryResolveAgentInterventionBySource = async (params: {
    action: AgentInterventionSourceAction;
    context?: ConversationContext;
    toolMessageIds: string[];
  }): Promise<ResolveAgentInterventionBySourceResult> => {
    const targets = params.toolMessageIds.map((toolMessageId) => {
      const message = dbMessageSelectors.getDbMessageById(toolMessageId)(this.#get());
      return {
        batchId: message?.pluginIntervention?.batchId,
        operationId: message?.pluginIntervention?.operationId,
        toolCallId: message?.tool_call_id,
        toolMessageId,
      };
    });
    const first = targets[0];
    if (
      !first?.batchId ||
      !first.operationId ||
      targets.some(
        (target) =>
          !target.toolCallId ||
          target.batchId !== first.batchId ||
          target.operationId !== first.operationId,
      )
    ) {
      return { handled: false };
    }

    const sourceTargets = targets.map(({ toolCallId, toolMessageId }) => ({
      toolCallId: toolCallId!,
      toolMessageId,
    }));
    const resolutionKey = JSON.stringify(
      canonicalizeResolutionPayload({
        action: params.action,
        batchId: first.batchId,
        operationId: first.operationId,
        targets: sourceTargets,
      }),
    );
    const resolutionRequestId =
      this.#interventionResolutionRequestIds.get(resolutionKey) ?? globalThis.crypto.randomUUID();
    this.#interventionResolutionRequestIds.set(resolutionKey, resolutionRequestId);

    const result = await aiAgentService.resolveAgentInterventionBySource({
      action: params.action,
      batchId: first.batchId,
      operationId: first.operationId,
      resolutionRequestId,
      targets: sourceTargets,
    });
    if (result.handled) {
      this.#interventionResolutionRequestIds.delete(resolutionKey);
      if (result.state === 'already_resolved' && params.context) {
        await this.#get().refreshMessages(params.context);
      }
    }
    return result;
  };

  /**
   * Decide whether approve/reject/reject_continue should go through the
   * Gateway resume path (new op carrying `resumeApproval`) instead of the
   * local `executeClientAgent` path. Mirrors the "interrupt + new op"
   * pattern from .
   *
   * Routes via `selectRuntimeType` so approve/reject align with how the
   * conversation was dispatched at sendMessage time. Hetero resume is not yet
   * implemented and falls through to client local resume — see .
   *
   * We deliberately do **not** look for a living `execServerAgentRuntime`
   * op here. The server's `waiting_for_human` → `agent_runtime_end` signal
   * marks the paused op `completed` client-side, and `startOperation` runs
   * `cleanupCompletedOperations(30_000)` on every new op, which means the
   * paused op is typically gone by the time the user clicks approve — so
   * scanning for it would flip us back into client-mode against a live
   * Gateway backend.
   */
  #shouldUseGatewayResume = (context: ConversationContext): boolean => {
    const agentConfig = context.agentId
      ? agentSelectors.getAgentConfigById(context.agentId)(getAgentStoreState())
      : undefined;
    return (
      selectRuntimeType({
        boundDeviceId: agentConfig?.agencyConfig?.boundDeviceId,
        executionTarget: agentConfig?.agencyConfig?.executionTarget,
        heterogeneousProvider: agentConfig?.agencyConfig?.heterogeneousProvider,
        isGatewayMode: this.#get().isGatewayModeEnabled(context.agentId),
      }) === 'gateway'
    );
  };

  /**
   * Return running (non-aborting) `execServerAgentRuntime` ops in the given
   * context. Used only to snapshot paused ops before starting a resume op
   * so we can retire them if the server-side `agent_runtime_end` signal is
   * delayed or missing — see `#completeOpsById`. In steady state with the
   * coordinator fix active, this returns an empty list by the time approve
   * runs because the server already completed the op.
   */
  #getRunningServerOps = (context: ConversationContext) => {
    const { agentId, groupId, scope, subAgentId, topicId, threadId } = context;
    if (!agentId) return [];
    const ops = operationSelectors.getOperationsByContext({
      agentId,
      groupId,
      scope,
      subAgentId,
      threadId: threadId ?? null,
      topicId: topicId ?? null,
    })(this.#get());
    return ops.filter(
      (op) =>
        op.type === 'execServerAgentRuntime' && op.status === 'running' && !op.metadata?.isAborting,
    );
  };

  #resolveHeteroInterventionExecutionOperation = (
    initialOperationId: string,
  ): { operation?: Operation; operationId: string } => {
    const operations: ChatStore['operations'] = this.#get().operations;
    const visited = new Set<string>();
    let currentOperationId: string | undefined = initialOperationId;
    let lastResolved: { operation?: Operation; operationId: string } | undefined;

    while (currentOperationId && !visited.has(currentOperationId)) {
      visited.add(currentOperationId);
      const operation: Operation | undefined = operations[currentOperationId];
      lastResolved = { operation, operationId: currentOperationId };

      if (!operation) break;

      // `sendMessage` is the tree root, but it does not own the AskUser bridge.
      // Stop at the runtime execution node that produced this intervention.
      if (
        operation.type === 'execHeterogeneousAgent' ||
        operation.type === 'execServerAgentRuntime'
      ) {
        return { operation, operationId: currentOperationId };
      }

      currentOperationId = operation.parentOperationId;
    }

    return lastResolved ?? { operationId: initialOperationId };
  };

  /**
   * Local tool-interaction resumes are continuations of the original request.
   * Preserve the request trigger so downstream chat requests keep the same
   * headers after a human-intervention pause.
   */
  #getRequestMetadataFromMessageChain = (
    anchorMessageId: string,
    fallbackMessages: UIChatMessage[] = [],
  ): Pick<MessageMetadata, 'trigger'> | undefined => {
    const messagesById = new Map<string, UIChatMessage>();
    const addMessages = (messages: UIChatMessage[]) => {
      for (const message of messages) {
        if (!messagesById.has(message.id)) messagesById.set(message.id, message);
      }
    };

    for (const messages of Object.values(this.#get().dbMessagesMap)) {
      addMessages(messages);
    }
    addMessages(fallbackMessages);

    const visitedIds = new Set<string>();
    let currentMessageId: string | undefined = anchorMessageId;

    while (currentMessageId && !visitedIds.has(currentMessageId)) {
      visitedIds.add(currentMessageId);

      const message = messagesById.get(currentMessageId);
      if (!message) return;

      const trigger = message.metadata?.trigger;
      if (trigger) return { trigger };

      currentMessageId = message.parentId;
    }
  };

  /**
   * Parent for the synthetic user turn that answers / skips a tool interaction.
   *
   * Anchor it on the assistant that requested the interaction — the tool
   * message's own parent — rather than leaving it null. A null parent makes the
   * turn a SECOND root of the topic, which `conversation-flow`'s doctor reports
   * as `segment-split`: the reader still shows it (roots are flattened in
   * order), but it starts a fresh parent chain, so anything walking the tree
   * (branch resolution, chain-based context assembly) loses the history before
   * it.
   *
   * Deliberately not the tool message itself: `canAnchor` in the doctor's
   * repair rule never treats a tool row as a spine tail, and this mirrors it so
   * the write side and the repair side agree on the same shape.
   */
  #interactionTurnParentId = (toolMessage: UIChatMessage): string | undefined =>
    toolMessage.parentId ?? undefined;

  /**
   * Client-side fallback guard that retires paused server ops once a Gateway
   * resume op has started successfully. The server emits `agent_runtime_end`
   * after `human_approve_required`, but if that event is delayed or the
   * backend lacks the fix the paused op would linger as "running" and keep
   * the loading spinner on. Callers must snapshot the IDs *before*
   * `executeGatewayAgent` and only invoke this helper after the resume call
   * resolves — completing eagerly on failure would erase the running marker
   * while the server is still paused, causing retries to miss the Gateway
   * branch and fall through to client-mode.
   */
  #completeOpsById = (opIds: readonly string[]): void => {
    const { completeOperation } = this.#get();
    for (const id of opIds) completeOperation(id);
  };

  /**
   * A durable source that reports `already_resolved` lost the first-winner
   * claim. `tryResolveAgentInterventionBySource` has already refreshed the
   * authoritative messages, so callers must not publish a resumed lifecycle,
   * execute, mark the topic active, or retire the actual paused operation.
   *
   * Actions that created an interim local operation before probing the source
   * still need to retire that temporary loading marker. Cancel it instead of
   * completing it so the losing action is never represented as a successful
   * resume.
   */
  #discardAlreadyResolvedSource = (
    result: ResolveAgentInterventionBySourceResult,
    interimOperationId?: string,
  ): boolean => {
    if (!result.handled || result.state !== 'already_resolved') return false;

    if (interimOperationId) {
      this.#get().cancelOperation(interimOperationId, 'Intervention already resolved');
    }
    return true;
  };

  #writeTopicStatus = (context: ConversationContext, status: ChatTopicStatus): void => {
    if (!context.topicId) return;

    const topicScope =
      context.scope === 'group' || context.scope === 'group_agent' ? context.scope : undefined;

    const statusWrite = this.#get().updateTopicStatus?.({
      agentId: context.agentId,
      groupId: context.groupId,
      ...(topicScope ? { scope: topicScope } : {}),
      status,
      topicId: context.topicId,
    });

    void statusWrite?.catch((error) => {
      console.error('[conversationControl] updateTopicStatus failed:', error);
    });
  };

  stopGenerateMessage = (): void => {
    const { activeAgentId, activeTopicId, cancelOperations } = this.#get();

    // Cancel running agent-runtime operations in the current context —
    // client-side (execAgentRuntime), heterogeneous agent (execHeterogeneousAgent),
    // and Gateway-mode (execServerAgentRuntime).
    cancelOperations(
      {
        type: AI_RUNTIME_OPERATION_TYPES,
        status: 'running',
        agentId: activeAgentId,
        topicId: activeTopicId,
      },
      MESSAGE_CANCEL_FLAT,
    );
  };

  cancelSendMessageInServer = (
    target?: string | ConversationContext,
    editor?: ChatInputEditor | null,
  ): void => {
    const { activeAgentId, activeGroupId, activeThreadId, activeTopicId } = this.#get();

    const activeContext: ConversationContext = {
      agentId: activeAgentId,
      groupId: activeGroupId,
      threadId: activeThreadId,
      topicId: activeTopicId,
    };
    const targetContext =
      typeof target === 'object'
        ? target
        : {
            ...activeContext,
            topicId: target ?? activeTopicId,
          };
    const contextKey = messageMapKey(targetContext);

    // Cancel operations in the operation system
    const operationIds = this.#get().operationsByContext[contextKey] || [];

    operationIds.forEach((opId) => {
      const operation = this.#get().operations[opId];
      if (operation && operation.type === 'sendMessage' && operation.status === 'running') {
        this.#get().cancelOperation(opId, 'User cancelled');
      }
    });

    // An embedded conversation (for example the create-thread portal) owns a
    // separate editor even though ChatStore only tracks the most recently
    // mounted editor globally. Prefer the explicitly supplied editor. The
    // active-conversation fallback preserves the legacy call sites.
    const targetEditor =
      editor ?? (contextKey === messageMapKey(activeContext) ? this.#get().mainInputEditor : null);
    if (targetEditor) {
      // Find the latest sendMessage operation with editor state
      for (const opId of [...operationIds].reverse()) {
        const op = this.#get().operations[opId];
        if (op && op.type === 'sendMessage' && op.metadata.inputEditorTempState) {
          targetEditor.setJSONState(op.metadata.inputEditorTempState);
          break;
        }
      }
    }
  };

  clearSendMessageError = (): void => {
    const { activeAgentId, activeGroupId, activeThreadId, activeTopicId } = this.#get();
    const contextKey = messageMapKey({
      agentId: activeAgentId,
      groupId: activeGroupId,
      threadId: activeThreadId,
      topicId: activeTopicId,
    });
    const operationIds = this.#get().operationsByContext[contextKey] || [];

    // Clear error message from all sendMessage operations in current context
    operationIds.forEach((opId) => {
      const op = this.#get().operations[opId];
      if (op && op.type === 'sendMessage' && op.metadata.inputSendErrorMsg) {
        this.#get().updateOperationMetadata(opId, { inputSendErrorMsg: undefined });
      }
    });
  };

  switchMessageBranch = async (
    messageId: string,
    branchIndex: number,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    await this.#get().optimisticUpdateMessageMetadata(
      messageId,
      { activeBranchIndex: branchIndex },
      context,
    );
  };

  /**
   * Broadcast that a parked run is resuming under a NEW operation. The resume
   * entries (approve / reject / reject-continue / submit / skip) call this at
   * dispatch so the park → resume transition flows through the unified run
   * lifecycle's `onRunResumed` seam instead of being invisible to it.
   *
   * Behavior-neutral: fires no terminal side effects and mutates no store state
   * (see `buildRunLifecycle.onRunResumed`). `buildRunLifecycle` is a pure factory,
   * so constructing a throwaway instance here purely to broadcast the resume is
   * cheap and side-effect-free; `[6]` AgentRunner is where the lifecycle becomes a
   * single per-run instance threaded through dispatch.
   */
  #emitRunResumed = (
    context: ConversationContext,
    params: { operationId: string; parentMessageId: string; runtimeType: AgentRuntimeType },
  ) => {
    const { operationId, parentMessageId, runtimeType } = params;
    const runScope: RunScope = context.scope === 'sub_agent' ? 'sub_agent' : 'top_level';
    void buildRunLifecycle(this.#get, {
      context,
      parentMessageId,
      parentMessageType: 'tool',
      runId: operationId,
      runScope,
      runtimeType,
    }).onRunResumed({
      context,
      operationId,
      resumedOperationId: operationId,
      runId: operationId,
      runScope,
      runtimeType,
    });
  };

  /**
   * Honor a Stop pressed during the optimistic-write window. Interim ops
   * (approve / submit / skip) are created synchronously, but their optimistic
   * updates await, so a Stop landing in that gap cancels the op via
   * `stopGenerating` → `cancelOperations`. Detect the cancelled/terminal op and
   * bail before starting the run instead of resurrecting a stopped conversation.
   * `cancelOperation` flips status but keeps the record, so a real Stop always
   * leaves the op present here. Mirrors regenerateUserMessage's preflight guard.
   */
  #wasInterimOpStopped = (operationId: string): boolean => {
    const op = this.#get().operations[operationId];
    return !!op && op.status !== 'running';
  };

  approveToolCalling = async (
    toolMessageId: string,
    _assistantGroupId: string,
    context?: ConversationContext,
    options?: {
      editedArguments?: Record<string, unknown>;
      onLegacyEditFallback?: () => Promise<void>;
      rememberToolKey?: string;
    },
  ): Promise<void> => {
    const { executeClientAgent, startOperation, completeOperation } = this.#get();

    // Build effective context from provided context or global state
    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    // 1. Get tool message and verify it exists
    const toolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(this.#get());
    if (!toolMessage) return;

    // Create an operation to carry the context for optimistic updates
    // This ensures optimistic updates use the correct agentId/topicId
    const { operationId } = startOperation({
      type: 'approveToolCalling',
      // Carry the full effective context (groupId / documentId / scope / …) so the
      // interim op lands in the same messageMapKey bucket the UI queries. A cherry-
      // picked context without groupId would bucket group conversations under
      // `main_<agentId>` while the UI reads `group_<groupId>`, so the input-loading
      // whitelist never matches there. Mirrors execServerAgentRuntime's execContext.
      context: {
        ...effectiveContext,
        messageId: toolMessageId,
      },
    });

    const optimisticContext = { operationId };
    const shouldUseGatewayResume = this.#shouldUseGatewayResume(effectiveContext);

    if (!shouldUseGatewayResume) {
      this.#writeTopicStatus(effectiveContext, 'active');
      // Park → resume: a new op continues the run paused on this tool's approval.
      this.#emitRunResumed(effectiveContext, {
        operationId,
        parentMessageId: toolMessageId,
        runtimeType: 'client',
      });
    }

    // Local runtime owns its message mutation. Gateway resumes claim the
    // still-pending row atomically on the server, so they must not persist an
    // optimistic approved state before calling the claim endpoint.
    if (!shouldUseGatewayResume) {
      await this.#get().optimisticUpdateMessagePlugin(
        toolMessageId,
        { intervention: { status: 'approved' } },
        optimisticContext,
      );
    }

    // NOTE: intentionally do NOT bail on Stop here. `intervention: approved` is
    // already persisted above; returning early would leave the tool marked
    // approved but never executed — a stuck conversation. Stop pressed in this
    // sub-second window is best-effort (the paused run can't be aborted yet);
    // let the approval complete atomically and honor the next Stop normally.
    const requestMetadata = this.#getRequestMetadataFromMessageChain(toolMessageId);

    // 2.5. Server-mode: start a **new** Gateway op carrying the approval
    // decision via `resumeApproval`. The server reads the target tool
    // message, persists `intervention=approved`, dispatches the approved
    // tool, and streams results back on the new op. No in-place resume of
    // the paused op — simpler state + avoids stepIndex races.
    if (shouldUseGatewayResume) {
      const toolCallId = toolMessage.tool_call_id;
      if (!toolCallId) {
        console.warn(
          '[approveToolCalling][server] tool message missing tool_call_id; skipping resume',
        );
        completeOperation(operationId);
        return;
      }
      // Snapshot paused op IDs before the resume call; retire them only
      // after executeGatewayAgent succeeds so a transient failure leaves
      // the running marker intact and `#shouldUseGatewayResume` still flags
      // Gateway mode on retry.
      const pausedOpIds = this.#getRunningServerOps(effectiveContext).map((op) => op.id);
      try {
        const sourceResolution = await this.tryResolveAgentInterventionBySource({
          action: {
            ...(options?.editedArguments && {
              edits: { [toolMessageId]: options.editedArguments },
            }),
            scope: options?.rememberToolKey ? 'remember' : 'once',
            type: 'approve_tool',
          },
          context: effectiveContext,
          toolMessageIds: [toolMessageId],
        });
        if (this.#discardAlreadyResolvedSource(sourceResolution, operationId)) return;

        this.#emitRunResumed(effectiveContext, {
          operationId,
          parentMessageId: toolMessageId,
          runtimeType: 'gateway',
        });
        if (sourceResolution.handled) {
          if (sourceResolution.execution) {
            await this.#get().executeGatewayAgent({
              context: effectiveContext,
              message: '',
              metadata: requestMetadata,
              parentMessageId: toolMessageId,
              precreatedResult: sourceResolution.execution,
            });
          }
        } else {
          // OSS compatibility: no generic durable store. Persist a staged edit
          // only now, after the generic capability probe, then use the existing
          // message-row claim path.
          if (options?.editedArguments) {
            await options.onLegacyEditFallback?.();
          }
          await this.#get().executeGatewayAgent({
            context: effectiveContext,
            message: '',
            metadata: requestMetadata,
            parentMessageId: toolMessageId,
            resumeApproval: {
              decision: 'approved',
              parentMessageId: toolMessageId,
              toolCallId,
            },
          });
          if (options?.rememberToolKey) {
            await useUserStore.getState().addToolToAllowList(options.rememberToolKey);
          }
        }
        this.#writeTopicStatus(effectiveContext, 'active');
        this.#completeOpsById(pausedOpIds);
        completeOperation(operationId);
      } catch (error) {
        const err = error as Error;
        console.error('[approveToolCalling][server] Gateway resume failed:', err);
        this.#get().failOperation(operationId, {
          type: 'approveToolCalling',
          message: err.message || 'Unknown error',
        });
        throw error;
      }
      return;
    }

    // 3. Get current messages for state construction using context
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());
    const currentRequestMetadata = this.#getRequestMetadataFromMessageChain(
      toolMessageId,
      currentMessages,
    );

    // 4. Create agent state and context with user intervention config
    const { state, context: initialContext } = this.#get().internal_createAgentState({
      messages: currentMessages,
      parentMessageId: toolMessageId,
      agentId,
      topicId,
      threadId: threadId ?? undefined,
      operationId,
    });

    // 5. Override context with 'human_approved_tool' phase
    const agentRuntimeContext: AgentRuntimeContext = {
      ...initialContext,
      phase: 'human_approved_tool',
      payload: {
        approvedToolCall: toolMessage.plugin,
        parentMessageId: toolMessageId,
        skipCreateToolMessage: true,
      },
    };

    // 7. Execute agent runtime from tool message position
    try {
      await executeClientAgent({
        context: effectiveContext,
        messages: currentMessages,
        parentMessageId: toolMessageId, // Start from tool message
        parentMessageType: 'tool', // Type is 'tool'
        initialState: state,
        initialContext: agentRuntimeContext,
        metadata: currentRequestMetadata,
        // Pass parent operation ID to establish parent-child relationship
        // This ensures proper cancellation propagation
        parentOperationId: operationId,
      });
      if (options?.rememberToolKey) {
        await useUserStore.getState().addToolToAllowList(options.rememberToolKey);
      }
      completeOperation(operationId);
    } catch (error) {
      const err = error as Error;
      console.error('[approveToolCalling] Error executing agent runtime:', err);
      this.#get().failOperation(operationId, {
        type: 'approveToolCalling',
        message: err.message || 'Unknown error',
      });
    }
  };

  /**
   * Approve every pending tool of a parallel batch in ONE action.
   *
   * Server mode resolves the whole batch through a single Gateway op carrying
   * `resumeApprovals`, so the run executes all approved tools as one
   * `call_tools_batch` and continues the LLM exactly once with the complete
   * result set. Looping `approveToolCalling` instead would start one op per
   * tool, and each op continues the run while its siblings are still empty
   * pending rows — which is what forks the parent chain and shows the model
   * blank tool results.
   *
   * Client mode has no batch resume: the local runtime re-parks on the
   * remaining pending tools after each approval, so sequential approvals are
   * already correct there. Approvals are issued in order and awaited so the
   * runtime never sees two resumes racing on the same assistant turn.
   */
  /**
   * Stop a run parked on tool approval — "from this step on, don't continue".
   *
   * Distinct from rejecting a tool: a rejection resumes the model so it can
   * respond to the refusal, whereas stopping ends the turn outright. Nothing
   * in the batch executes.
   *
   * This cannot go through the ordinary cancel actions: they all filter on
   * `status === 'running'`, and a parked run's client operation is `completed`
   * (the server's park is stream-terminal) and pruned ~30s later, so the client
   * no longer holds its operation object. The pending tool rows retain the
   * authoritative operationId + sealed batchId, which are the only identities
   * accepted by the server stop path.
   */
  stopPendingApproval = async (
    toolMessageIds: string[],
    context?: ConversationContext,
  ): Promise<void> => {
    if (toolMessageIds.length === 0) return;

    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const topicId = effectiveContext.topicId;
    if (!topicId) {
      console.warn('[stopPendingApproval] no active topic; skipping');
      return;
    }

    // Only rows the server can address — an optimistic `tmp_` row has no server
    // identity yet.
    const addressable = toolMessageIds.filter((id) => !id.startsWith('tmp_'));
    if (addressable.length === 0) return;

    const targets = addressable.map((id) => dbMessageSelectors.getDbMessageById(id)(this.#get()));
    const operationId = targets[0]?.pluginIntervention?.operationId;
    const batchId = targets[0]?.pluginIntervention?.batchId;
    if (
      !operationId ||
      !batchId ||
      targets.some(
        (message) =>
          !message ||
          message.pluginIntervention?.operationId !== operationId ||
          message.pluginIntervention?.batchId !== batchId,
      )
    ) {
      console.warn('[stopPendingApproval] missing or mixed authoritative batch identity; skipping');
      return;
    }

    const pausedOpIds = this.#getRunningServerOps(effectiveContext).map((op) => op.id);

    try {
      const sourceResolution = await this.tryResolveAgentInterventionBySource({
        action: { scope: 'operation', type: 'stop' },
        context: effectiveContext,
        toolMessageIds: addressable,
      });
      if (this.#discardAlreadyResolvedSource(sourceResolution)) return;

      if (!sourceResolution.handled) {
        await aiAgentService.stopPendingApproval({
          batchId,
          operationId,
          toolMessageIds: addressable,
          topicId,
        });
      }
      this.#completeOpsById(pausedOpIds);
    } catch (error) {
      console.error('[stopPendingApproval] failed:', error);
      throw error;
    }
  };

  approveAllToolCalls = async (
    toolMessageIds: string[],
    context?: ConversationContext,
  ): Promise<void> => {
    if (toolMessageIds.length === 0) return;

    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    if (!this.#shouldUseGatewayResume(effectiveContext)) {
      for (const toolMessageId of toolMessageIds) {
        await this.approveToolCalling(toolMessageId, '', effectiveContext);
      }
      return;
    }

    const { completeOperation, startOperation } = this.#get();

    // Drop anything that can't be addressed: an optimistic row (`tmp_`) has no
    // server identity yet, and a tool message without `tool_call_id` can't be
    // matched to its pending call.
    const decisions = toolMessageIds
      .map((toolMessageId) => {
        const toolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(this.#get());
        const toolCallId = toolMessage?.tool_call_id;
        return toolCallId && !toolMessageId.startsWith('tmp_')
          ? { decision: 'approved' as const, parentMessageId: toolMessageId, toolCallId }
          : undefined;
      })
      .filter((decision) => !!decision);

    if (decisions.length === 0) {
      console.warn('[approveAllToolCalls][server] no addressable pending tools; skipping resume');
      return;
    }

    // The op-level anchor. The server re-derives the spine anchor from the
    // batch itself, so this only has to be one of the batch's own rows.
    const anchorMessageId = decisions.at(-1)!.parentMessageId;

    const { operationId } = startOperation({
      type: 'approveToolCalling',
      context: { ...effectiveContext, messageId: anchorMessageId },
    });

    const requestMetadata = this.#getRequestMetadataFromMessageChain(anchorMessageId);
    const pausedOpIds = this.#getRunningServerOps(effectiveContext).map((op) => op.id);

    try {
      const sourceResolution = await this.tryResolveAgentInterventionBySource({
        action: { scope: 'once', type: 'approve_tool' },
        context: effectiveContext,
        toolMessageIds: decisions.map(({ parentMessageId }) => parentMessageId),
      });
      if (this.#discardAlreadyResolvedSource(sourceResolution, operationId)) return;

      this.#emitRunResumed(effectiveContext, {
        operationId,
        parentMessageId: anchorMessageId,
        runtimeType: 'gateway',
      });
      if (sourceResolution.handled) {
        if (sourceResolution.execution) {
          await this.#get().executeGatewayAgent({
            context: effectiveContext,
            message: '',
            metadata: requestMetadata,
            parentMessageId: anchorMessageId,
            precreatedResult: sourceResolution.execution,
          });
        }
      } else {
        await this.#get().executeGatewayAgent({
          context: effectiveContext,
          message: '',
          metadata: requestMetadata,
          parentMessageId: anchorMessageId,
          resumeApprovals: decisions,
        });
      }
      this.#writeTopicStatus(effectiveContext, 'active');
      this.#completeOpsById(pausedOpIds);
      completeOperation(operationId);
    } catch (error) {
      const err = error as Error;
      console.error('[approveAllToolCalls][server] Gateway resume failed:', err);
      this.#get().failOperation(operationId, {
        type: 'approveToolCalling',
        message: err.message || 'Unknown error',
      });
      throw error;
    }
  };

  submitToolInteraction = async (
    toolMessageId: string,
    response: Record<string, unknown>,
    context?: ConversationContext,
    options?: {
      agentInterventionAction?: Extract<
        AgentInterventionSourceAction,
        { type: 'submit_answers' | 'submit_custom' }
      >;
      createUserMessage?: boolean;
      prepareLegacyFallback?: () => Promise<{
        createUserMessage?: boolean;
        pluginState?: Record<string, unknown>;
        response: Record<string, unknown>;
        toolResultContent?: string;
      }>;
      pluginState?: Record<string, unknown>;
      toolResultContent?: string;
    },
  ): Promise<void> => {
    const { executeClientAgent, startOperation, completeOperation } = this.#get();

    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    const toolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(this.#get());
    if (!toolMessage) return;

    const { operationId } = startOperation({
      type: 'submitToolInteraction',
      // Carry the full effective context so the interim op is bucketed under the
      // same messageMapKey the UI queries (group / page need groupId / documentId,
      // not just agentId) — otherwise the input-loading whitelist never matches
      // there. Mirrors execServerAgentRuntime's execContext.
      context: {
        ...effectiveContext,
        messageId: toolMessageId,
      },
    });

    const optimisticContext: OptimisticUpdateContext = { operationId };
    let resolvedOptions = options;
    let resolvedResponse = response;
    const shouldCreateUserMessage = resolvedOptions?.createUserMessage !== false;
    const shouldUseGatewayResume = this.#shouldUseGatewayResume(effectiveContext);

    if (!shouldUseGatewayResume) {
      this.#writeTopicStatus(effectiveContext, 'active');
      // Park → resume: a new op continues the run paused on this tool interaction.
      this.#emitRunResumed(effectiveContext, {
        operationId,
        parentMessageId: toolMessageId,
        runtimeType: 'client',
      });
    }

    let toolContent =
      resolvedOptions?.toolResultContent ?? `User submitted: ${JSON.stringify(resolvedResponse)}`;
    if (!shouldUseGatewayResume) {
      // Client runtime owns its local pending row. Gateway must leave the DB
      // row pending until resumeToolResult acquires the server-side CAS.
      await this.#get().optimisticUpdateMessagePlugin(
        toolMessageId,
        { intervention: { status: 'approved' } },
        optimisticContext,
      );
      await this.#get().optimisticUpdateMessageContent(
        toolMessageId,
        toolContent,
        undefined,
        optimisticContext,
      );

      if (resolvedOptions?.pluginState) {
        await this.#get().optimisticUpdatePluginState(
          toolMessageId,
          resolvedOptions.pluginState,
          optimisticContext,
        );
      }
    }

    // NOTE: intentionally do NOT bail on Stop here. In client mode the result
    // is already persisted; in Gateway mode the authoritative claim+resume
    // below is the indivisible action. Honor the next Stop after it settles.

    // 1.5. Server-mode: start a **new** Gateway op carrying the human answer as
    // the tool result via `resumeToolResult`. The server writes the answer as
    // the pending tool message's content, marks intervention approved, and
    // resumes from `phase: 'tool_result'` (NO re-execution). The synthetic user
    // message (2b) is not needed — the server continues from the answered tool
    // call. Mirrors approveToolCalling's gateway branch.
    if (shouldUseGatewayResume) {
      const toolCallId = toolMessage.tool_call_id;
      if (!toolCallId) {
        console.warn(
          '[submitToolInteraction][server] tool message missing tool_call_id; skipping resume',
        );
        completeOperation(operationId);
        return;
      }
      const requestMetadata = this.#getRequestMetadataFromMessageChain(toolMessageId);
      // Snapshot paused op IDs before the resume call; retire them only after
      // executeGatewayAgent succeeds so a transient failure leaves the running
      // marker intact and `#shouldUseGatewayResume` still flags Gateway mode.
      const pausedOpIds = this.#getRunningServerOps(effectiveContext).map((op) => op.id);
      try {
        const answerResult = toAgentInterventionAnswerResult(resolvedResponse);
        const sourceAction =
          resolvedOptions?.agentInterventionAction ??
          (answerResult ? ({ result: answerResult, type: 'submit_answers' } as const) : undefined);
        const sourceResolution = sourceAction
          ? await this.tryResolveAgentInterventionBySource({
              action: sourceAction,
              context: effectiveContext,
              toolMessageIds: [toolMessageId],
            })
          : { handled: false as const };

        if (this.#discardAlreadyResolvedSource(sourceResolution, operationId)) return;

        this.#emitRunResumed(effectiveContext, {
          operationId,
          parentMessageId: toolMessageId,
          runtimeType: 'gateway',
        });

        if (sourceResolution.handled) {
          if (sourceResolution.execution) {
            await this.#get().executeGatewayAgent({
              context: effectiveContext,
              message: '',
              metadata: requestMetadata,
              parentMessageId: toolMessageId,
              precreatedResult: sourceResolution.execution,
            });
          }
        } else {
          const legacyFallback = await resolvedOptions?.prepareLegacyFallback?.();
          if (legacyFallback) {
            resolvedResponse = legacyFallback.response;
            resolvedOptions = { ...resolvedOptions, ...legacyFallback };
            toolContent =
              resolvedOptions.toolResultContent ??
              `User submitted: ${JSON.stringify(resolvedResponse)}`;
          }
          await this.#get().executeGatewayAgent({
            context: effectiveContext,
            message: '',
            metadata: requestMetadata,
            parentMessageId: toolMessageId,
            resumeToolResult: {
              content: toolContent,
              outcome: 'submitted',
              parentMessageId: toolMessageId,
              toolCallId,
              ...(resolvedOptions?.pluginState ? { pluginState: resolvedOptions.pluginState } : {}),
            },
          });
        }
        this.#writeTopicStatus(effectiveContext, 'active');
        this.#completeOpsById(pausedOpIds);
        completeOperation(operationId);
      } catch (error) {
        const err = error as Error;
        console.error('[submitToolInteraction][server] Gateway resume failed:', err);
        this.#get().failOperation(operationId, {
          type: 'submitToolInteraction',
          message: err.message || 'Unknown error',
        });
        throw error;
      }
      return;
    }

    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });

    // 2a. Tool-result-only path: skip the synthetic user message and resume from the
    // tool message. Used by interventions whose UI handles its own side effect (e.g.
    // the agent marketplace picker forks agents directly) — the LLM should see the
    // tool result, not a fake user turn.
    if (!shouldCreateUserMessage) {
      const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());
      const requestMetadata = this.#getRequestMetadataFromMessageChain(
        toolMessageId,
        currentMessages,
      );

      const { state, context: initialContext } = this.#get().internal_createAgentState({
        messages: currentMessages,
        parentMessageId: toolMessageId,
        agentId,
        topicId,
        threadId: threadId ?? undefined,
        operationId,
      });

      // Resume directly from `tool_result` phase rather than `human_approved_tool`.
      // The intervention UI already wrote the final tool result content via
      // `optimisticUpdateMessageContent`; routing through `human_approved_tool`
      // would re-execute the builtin tool on the server and overwrite our
      // content with the server-side placeholder (e.g. the marketplace picker
      // would clobber the picked-templates result with "picker is now visible").
      const agentRuntimeContext: AgentRuntimeContext = {
        ...initialContext,
        phase: 'tool_result',
        payload: {
          parentMessageId: toolMessageId,
        },
      };

      try {
        await executeClientAgent({
          context: effectiveContext,
          messages: currentMessages,
          parentMessageId: toolMessageId,
          parentMessageType: 'tool',
          initialState: state,
          initialContext: agentRuntimeContext,
          metadata: requestMetadata,
          parentOperationId: operationId,
        });
        completeOperation(operationId);
      } catch (error) {
        const err = error as Error;
        console.error('[submitToolInteraction] Error executing agent runtime:', err);
        this.#get().failOperation(operationId, {
          type: 'submitToolInteraction',
          message: err.message || 'Unknown error',
        });
      }
      return;
    }

    // 2b. Default path: create a user message summarizing the response, resume from user
    const requestMetadata = this.#getRequestMetadataFromMessageChain(toolMessageId);
    const userMessageContent = Object.values(resolvedResponse).join(', ');
    const groupId = toolMessage.groupId;
    const userMsg = await this.#get().optimisticCreateMessage(
      {
        agentId: agentId!,
        content: userMessageContent,
        groupId: groupId ?? undefined,
        ...(requestMetadata && { metadata: requestMetadata }),
        parentId: this.#interactionTurnParentId(toolMessage),
        role: 'user',
        threadId: threadId ?? undefined,
        topicId: topicId ?? undefined,
      },
      optimisticContext,
    );

    if (!userMsg) {
      this.#get().failOperation(operationId, {
        type: 'submitToolInteraction',
        message: 'Failed to create user message',
      });
      return;
    }

    // Bail if a Stop landed while the synthetic user message was being created:
    // optimisticCreateMessage above is another await round-trip after the earlier
    // guard, and executeClientAgent would otherwise start a fresh child run that
    // wasn't present when the cancellation propagated.
    if (this.#wasInterimOpStopped(operationId)) return;

    // 3. Resume agent from user message (not tool re-execution)
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());

    const { state, context: initialContext } = this.#get().internal_createAgentState({
      messages: currentMessages,
      parentMessageId: userMsg.id,
      agentId,
      topicId,
      threadId: threadId ?? undefined,
      operationId,
    });

    try {
      await executeClientAgent({
        context: effectiveContext,
        messages: currentMessages,
        parentMessageId: userMsg.id,
        parentMessageType: 'user',
        initialState: state,
        initialContext,
        metadata: requestMetadata,
        parentOperationId: operationId,
      });
      completeOperation(operationId);
    } catch (error) {
      const err = error as Error;
      console.error('[submitToolInteraction] Error executing agent runtime:', err);
      this.#get().failOperation(operationId, {
        type: 'submitToolInteraction',
        message: err.message || 'Unknown error',
      });
    }
  };

  skipToolInteraction = async (
    toolMessageId: string,
    reason?: string,
    context?: ConversationContext,
    options?: { onLegacyFallback?: () => Promise<void> },
  ): Promise<void> => {
    const { executeClientAgent, startOperation, completeOperation } = this.#get();

    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    const toolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(this.#get());
    if (!toolMessage) return;

    const { operationId } = startOperation({
      type: 'skipToolInteraction',
      // Carry the full effective context so the interim op is bucketed under the
      // same messageMapKey the UI queries (group / page need groupId / documentId,
      // not just agentId) — otherwise the input-loading whitelist never matches
      // there. Mirrors execServerAgentRuntime's execContext.
      context: {
        ...effectiveContext,
        messageId: toolMessageId,
      },
    });

    const optimisticContext: OptimisticUpdateContext = { operationId };
    const shouldUseGatewayResume = this.#shouldUseGatewayResume(effectiveContext);

    if (!shouldUseGatewayResume) {
      this.#writeTopicStatus(effectiveContext, 'active');
      // Park → resume: a new op continues the run paused on this tool interaction.
      this.#emitRunResumed(effectiveContext, {
        operationId,
        parentMessageId: toolMessageId,
        runtimeType: 'client',
      });
    }

    const toolContent = reason ? `User skipped: ${reason}` : 'User skipped this question.';

    // Gateway owns the pending-row claim. Do not persist an optimistic
    // `rejected` state first: the authoritative resume endpoint deliberately
    // accepts only pending rows, so a client-side write would make its own
    // request lose the first-winner CAS.
    if (shouldUseGatewayResume) {
      const toolCallId = toolMessage.tool_call_id;
      if (!toolCallId) {
        console.warn(
          '[skipToolInteraction][server] tool message missing tool_call_id; skipping resume',
        );
        completeOperation(operationId);
        return;
      }
      const requestMetadata = this.#getRequestMetadataFromMessageChain(toolMessageId);
      const pausedOpIds = this.#getRunningServerOps(effectiveContext).map((op) => op.id);
      try {
        const sourceResolution = await this.tryResolveAgentInterventionBySource({
          action: { type: 'skip_interaction' },
          context: effectiveContext,
          toolMessageIds: [toolMessageId],
        });
        if (this.#discardAlreadyResolvedSource(sourceResolution, operationId)) return;

        this.#emitRunResumed(effectiveContext, {
          operationId,
          parentMessageId: toolMessageId,
          runtimeType: 'gateway',
        });
        if (sourceResolution.handled) {
          if (sourceResolution.execution) {
            await this.#get().executeGatewayAgent({
              context: effectiveContext,
              message: '',
              metadata: requestMetadata,
              parentMessageId: toolMessageId,
              precreatedResult: sourceResolution.execution,
            });
          }
        } else {
          await options?.onLegacyFallback?.();
          await this.#get().executeGatewayAgent({
            context: effectiveContext,
            message: '',
            metadata: requestMetadata,
            parentMessageId: toolMessageId,
            resumeToolResult: {
              content: toolContent,
              outcome: 'skipped',
              parentMessageId: toolMessageId,
              rejectionReason: reason,
              toolCallId,
            },
          });
        }
        this.#writeTopicStatus(effectiveContext, 'active');
        this.#completeOpsById(pausedOpIds);
        completeOperation(operationId);
      } catch (error) {
        const err = error as Error;
        console.error('[skipToolInteraction][server] Gateway resume failed:', err);
        this.#get().failOperation(operationId, {
          type: 'skipToolInteraction',
          message: err.message || 'Unknown error',
        });
        throw error;
      }
      return;
    }

    // 1. Mark intervention as rejected (skipped) with reason
    await this.#get().optimisticUpdateMessagePlugin(
      toolMessageId,
      { intervention: { rejectedReason: reason, skipped: true, status: 'rejected' } },
      optimisticContext,
    );

    await this.#get().optimisticUpdateMessageContent(
      toolMessageId,
      toolContent,
      undefined,
      optimisticContext,
    );

    // Bail if a Stop landed while the optimistic updates above were in flight,
    // before creating the synthetic user message so Stop leaves no dangling turn.
    if (this.#wasInterimOpStopped(operationId)) return;

    // 2. Create a user message indicating the skip
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const requestMetadata = this.#getRequestMetadataFromMessageChain(toolMessageId);
    const userMessageContent = reason
      ? t('tool.intervention.skipMessageWithReason', { ns: 'chat', reason })
      : t('tool.intervention.skipMessage', { ns: 'chat' });
    const groupId = toolMessage.groupId;
    const userMsg = await this.#get().optimisticCreateMessage(
      {
        agentId: agentId!,
        content: userMessageContent,
        groupId: groupId ?? undefined,
        ...(requestMetadata && { metadata: requestMetadata }),
        parentId: this.#interactionTurnParentId(toolMessage),
        role: 'user',
        threadId: threadId ?? undefined,
        topicId: topicId ?? undefined,
      },
      optimisticContext,
    );

    if (!userMsg) {
      this.#get().failOperation(operationId, {
        type: 'skipToolInteraction',
        message: 'Failed to create user message',
      });
      return;
    }

    // Bail if a Stop landed while the synthetic user message was being created:
    // optimisticCreateMessage above is another await round-trip after the guard
    // before it, and executeClientAgent would otherwise start a fresh child run
    // that wasn't present when the cancellation propagated.
    if (this.#wasInterimOpStopped(operationId)) return;

    // 3. Resume agent from user message
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());

    const { state, context: initialContext } = this.#get().internal_createAgentState({
      messages: currentMessages,
      parentMessageId: userMsg.id,
      agentId,
      topicId,
      threadId: threadId ?? undefined,
      operationId,
    });

    try {
      await executeClientAgent({
        context: effectiveContext,
        messages: currentMessages,
        parentMessageId: userMsg.id,
        parentMessageType: 'user',
        initialState: state,
        initialContext,
        metadata: requestMetadata,
        parentOperationId: operationId,
      });
      completeOperation(operationId);
    } catch (error) {
      const err = error as Error;
      console.error('[skipToolInteraction] Error executing agent runtime:', err);
      this.#get().failOperation(operationId, {
        type: 'skipToolInteraction',
        message: err.message || 'Unknown error',
      });
    }
  };

  cancelToolInteraction = async (
    toolMessageId: string,
    context?: ConversationContext,
    options?: { onLegacyFallback?: () => Promise<void> },
  ): Promise<void> => {
    const { startOperation, completeOperation } = this.#get();

    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    const toolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(this.#get());
    if (!toolMessage) return;
    const shouldUseGatewayStop = this.#shouldUseGatewayResume(effectiveContext);

    const { operationId } = startOperation({
      type: 'cancelToolInteraction',
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId: toolMessageId,
      },
    });

    const optimisticContext = { operationId };

    // A Gateway custom cancel is terminal: recordCustomInteractionResolution
    // has already persisted the custom side effect, then this path stops the
    // authoritative parked operation and its complete sealed batch. It must
    // not merely paint the one card rejected and leave the server op waiting.
    if (shouldUseGatewayStop) {
      const batchId = toolMessage.pluginIntervention?.batchId;
      const parkedOperationId = toolMessage.pluginIntervention?.operationId;
      if (!batchId || !parkedOperationId) {
        console.warn('[cancelToolInteraction][server] missing authoritative batch identity');
        completeOperation(operationId);
        return;
      }

      const batchToolMessageIds = [
        ...new Set(
          Object.values(this.#get().dbMessagesMap)
            .flat()
            .filter(
              (message) =>
                message.role === 'tool' &&
                message.pluginIntervention?.batchId === batchId &&
                message.pluginIntervention?.operationId === parkedOperationId,
            )
            .map(({ id }) => id),
        ),
      ];
      try {
        const sourceResolution = await this.tryResolveAgentInterventionBySource({
          action: { type: 'cancel_interaction' },
          context: effectiveContext,
          toolMessageIds: [toolMessageId],
        });
        if (this.#discardAlreadyResolvedSource(sourceResolution, operationId)) return;

        if (!sourceResolution.handled) {
          await options?.onLegacyFallback?.();
          await this.stopPendingApproval(
            batchToolMessageIds.length > 0 ? batchToolMessageIds : [toolMessageId],
            effectiveContext,
          );
        }
        completeOperation(operationId);
      } catch (error) {
        const err = error as Error;
        this.#get().failOperation(operationId, {
          type: 'cancelToolInteraction',
          message: err.message || 'Unknown error',
        });
        throw error;
      }
      return;
    }

    this.#writeTopicStatus(effectiveContext, 'active');

    await this.#get().optimisticUpdateMessagePlugin(
      toolMessageId,
      { intervention: { rejectedReason: 'User cancelled interaction', status: 'rejected' } },
      optimisticContext,
    );

    const toolContent = 'User cancelled this interaction.';
    await this.#get().optimisticUpdateMessageContent(
      toolMessageId,
      toolContent,
      undefined,
      optimisticContext,
    );

    completeOperation(operationId);
  };

  /**
   * Resolve a heterogeneous-runtime intervention (CC AskUserQuestion, …).
   *
   * Why this action exists separately from `submitToolInteraction`:
   * - The CC subprocess is already running and blocked on an MCP call —
   *   we need to feed the answer back through the IPC bridge, not spawn
   *   a fresh `executeClientAgent` turn.
   * - Once the answer ships, CC's existing stream emits `tool_result` and
   *   keeps going on its own; no synthetic user message, no new op.
   *
   * The framework's intervention surface still drives the UI: we just
   * stamp the local terminal state immediately. Remote submits remain
   * `pending + resolving` until the blocked producer echoes its ACK, so the
   * form stays visible and disabled across remounts without claiming success.
   *
   * `actionType`:
   *   - `'submit'` → ship `payload` as the answer
   *   - `'skip' | 'cancel'` → ship `cancelled: true` so the
   *     bridge resolves with `cancelReason` and CC sees an isError result
   *     (it'll fall back to plain-text questioning)
   */
  submitHeteroIntervention = async (
    toolMessageId: string,
    actionType: 'submit' | 'skip' | 'cancel',
    payload?: Record<string, unknown>,
    context?: ConversationContext,
  ): Promise<void> => {
    const toolMessage = dbMessageSelectors.getDbMessageById(toolMessageId)(this.#get());
    if (!toolMessage) return;

    const toolCallId = toolMessage.tool_call_id;
    if (!toolCallId) {
      console.warn('[submitHeteroIntervention] tool message has no tool_call_id', toolMessageId);
      return;
    }

    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };
    const originalIntervention = toolMessage.pluginIntervention;
    const originalContent = toolMessage.content;
    const interventionState = (
      toolMessage.pluginState as
        { heterogeneousIntervention?: { interactionKind?: unknown } } | undefined
    )?.heterogeneousIntervention;
    const sourceAction = toHeterogeneousSourceAction(
      actionType,
      interventionState?.interactionKind,
      payload ?? {},
    );

    // A persisted v2 card carries everything the server needs to locate and
    // authorize the intervention. Resolve it before consulting ephemeral
    // operation memory so refresh/cold-start submissions still reach the
    // durable first-winner claim. The message/runtime ids are locators only;
    // the source endpoint remains responsible for ACL and token authority.
    if (originalIntervention?.batchId && originalIntervention.operationId && sourceAction) {
      const sourceResolution = await this.tryResolveAgentInterventionBySource({
        action: sourceAction,
        context: effectiveContext,
        toolMessageIds: [toolMessageId],
      });
      if (this.#discardAlreadyResolvedSource(sourceResolution)) return;

      if (sourceResolution.handled) {
        const sourceOptimisticContext: OptimisticUpdateContext = { context: effectiveContext };
        const resolvingIntervention = {
          ...originalIntervention,
          resolving: true,
          status: 'pending' as const,
        };
        this.#get().internal_dispatchMessage(
          {
            id: toolMessageId,
            type: 'updateMessage',
            value: { pluginIntervention: resolvingIntervention },
          },
          sourceOptimisticContext,
        );
        if (toolMessage.parentId) {
          this.#get().internal_dispatchMessage(
            {
              id: toolMessage.parentId,
              tool_call_id: toolCallId,
              type: 'updateMessageTools',
              value: { intervention: resolvingIntervention },
            },
            sourceOptimisticContext,
          );
        }
        if (actionType === 'submit') {
          await this.setInterventionAnswers(toolMessageId, payload ?? {}, sourceOptimisticContext);
        }
        return;
      }
    }

    // Walk up to the assistant that owns this tool. `messageOperationMap` is a
    // most-granular pointer, so it may reference a transient child op
    // (`reasoning`, `toolCalling`, ...), not the runtime execution that owns
    // the AskUser bridge. This memory-only lookup is deliberately deferred
    // until the durable path is unavailable or reports `handled: false`; it is
    // provenance for local desktop IPC / legacy fallback, never server auth.
    const { messageOperationMap } = this.#get();
    const candidateOperationId =
      (toolMessage.parentId && messageOperationMap?.[toolMessage.parentId]) ??
      messageOperationMap?.[toolMessageId];

    if (!candidateOperationId) {
      console.warn('[submitHeteroIntervention] no operationId for', toolMessageId);
      return;
    }

    // Resolve the runtime execution op before choosing IPC vs remote transport.
    // For local CC this is `execHeterogeneousAgent`; for gateway/device runs
    // this is `execServerAgentRuntime`.
    const { operation, operationId } =
      this.#resolveHeteroInterventionExecutionOperation(candidateOperationId);

    // If the operation has already been garbage-collected (e.g. the bridge
    // timed out earlier and `runtime_end` rolled the op into `completed`
    // 30s+ ago), don't pass the stale opId into the optimistic chain — the
    // `internal_getConversationContext` fallback uses global state, which
    // matches the active conversation the user just clicked in. The IPC
    // submit below stays unchanged: `bridge.resolve()` no-ops on unknown
    // toolCallIds, so it's safe to fire even when the bridge is gone.
    const operationAlive = !!operation;
    if (!operationAlive) {
      console.warn(
        '[submitHeteroIntervention] operation already gone, using global-state fallback for optimistic write:',
        operationId,
      );
    }
    const optimisticContext: OptimisticUpdateContext = operationAlive ? { operationId } : {};
    const isLocalDesktopHetero = operation?.type === 'execHeterogeneousAgent';

    if (!isLocalDesktopHetero) {
      // Publishing the user intent is not completion. Keep the interaction
      // pending but mark its in-flight phase so a remount/retry cannot present
      // an optimistic terminal state before the producer has consumed it.
      await this.#get().optimisticUpdateMessagePlugin(
        toolMessageId,
        { intervention: { resolving: true, status: 'pending' } },
        optimisticContext,
      );
      if (actionType === 'submit') {
        await this.setInterventionAnswers(toolMessageId, payload ?? {}, optimisticContext);
      }
    } else if (actionType === 'submit') {
      await this.#get().optimisticUpdateMessagePlugin(
        toolMessageId,
        { intervention: { status: 'approved' } },
        optimisticContext,
      );
      // Persist the structured `{ [questionText]: selectedLabel(s) }` answers
      // to `pluginState.askUserAnswers` so the Render component can show
      // Q&A pairs instead of parsing the bridge's prose `User answers:`
      // dump out of `content`. Best-effort — never block the IPC submit.
      await this.setInterventionAnswers(toolMessageId, payload ?? {}, optimisticContext);
      // Bridge formats its own "User answers:" string for CC, so the eventual
      // tool_result re-rewrites this content. The optimistic write is just
      // for the brief gap between Submit and CC echoing the result back.
      const summary = `User submitted: ${JSON.stringify(payload ?? {})}`;
      await this.#get().optimisticUpdateMessageContent(
        toolMessageId,
        summary,
        undefined,
        optimisticContext,
      );
    } else {
      const reason = actionType === 'skip' ? 'User skipped' : 'User cancelled';
      await this.#get().optimisticUpdateMessagePlugin(
        toolMessageId,
        {
          intervention: {
            rejectedReason: reason,
            skipped: actionType === 'skip',
            status: 'rejected',
          },
        },
        optimisticContext,
      );
      await this.#get().optimisticUpdateMessageContent(
        toolMessageId,
        `${reason} this interaction.`,
        undefined,
        optimisticContext,
      );
    }

    // Forward the answer to the producer over the transport THIS op actually
    // ran on — read from the op itself, not re-derived from the current agent
    // config (which drifts if the user changed the execution target after
    // dispatch, or answers while a different agent is active).
    //
    // A local desktop CC run is an `execHeterogeneousAgent` op whose producer
    // lives in the Electron main → resolve the bridge over IPC. Anything else —
    // a gateway-dispatched remote sandbox/device run (`execServerAgentRuntime`),
    // or an op already GC'd after its waiting-for-human signal — is remote:
    // publish the answer via tRPC → Redis stream → the exec's long-poll →
    // `bridge.resolve()`. Local hetero ops stay `running` while CC is blocked on
    // the question, so they are never GC'd out from under this check; that makes
    // "not an alive execHeterogeneousAgent op" a safe signal for "remote".
    // Both paths are idempotent on an unknown / already-settled toolCallId.
    try {
      if (isLocalDesktopHetero) {
        // Dynamic import keeps `@/services/electron/*` out of non-Electron bundles.
        const { heterogeneousAgentService } =
          await import('@/services/electron/heterogeneousAgent');
        await heterogeneousAgentService.submitIntervention(
          actionType === 'submit'
            ? { operationId, result: payload ?? {}, toolCallId }
            : { cancelReason: 'user_cancelled', cancelled: true, operationId, toolCallId },
        );
      } else {
        const resolutionIntent = JSON.stringify(
          canonicalizeResolutionPayload({ actionType, payload: payload ?? {} }),
        );
        const resolutionKey = `${operationId}:${toolCallId}:${resolutionIntent}`;
        const resolutionRequestId =
          this.#heteroResolutionRequestIds.get(resolutionKey) ?? globalThis.crypto.randomUUID();
        this.#heteroResolutionRequestIds.set(resolutionKey, resolutionRequestId);
        await lambdaClient.aiAgent.submitHeteroIntervention.mutate(
          actionType === 'submit'
            ? { operationId, resolutionRequestId, result: payload ?? {}, toolCallId }
            : {
                cancelReason: 'user_cancelled',
                cancelled: true,
                operationId,
                resolutionRequestId,
                toolCallId,
              },
        );
      }
    } catch (err) {
      console.error('[submitHeteroIntervention] submitIntervention failed:', err);
      await this.#get().optimisticUpdateMessagePlugin(
        toolMessageId,
        { intervention: originalIntervention ?? { status: 'pending' } },
        optimisticContext,
      );
      if (isLocalDesktopHetero) {
        await this.#get().optimisticUpdateMessageContent(
          toolMessageId,
          originalContent,
          undefined,
          optimisticContext,
        );
      }
      throw err;
    }

    // Sidebar topic row was swapped to the `waitingForHuman` hand icon when
    // the intervention was raised; once the user submits/skips/cancels the
    // CC stream resumes so flip it back to `running`. The natural completion
    // (`runtime_end` → `writeTopicStatus('active')`) takes over from there.
    if (isLocalDesktopHetero && effectiveContext.topicId) {
      void this.#get().updateTopicStatus?.({
        agentId: effectiveContext.agentId,
        groupId: effectiveContext.groupId,
        status: 'running',
        topicId: effectiveContext.topicId,
      });
    }
  };

  /**
   * In-memory draft store for an intervention form. Backs the renderer's
   * "remember what I'd partially answered" behaviour without paying for a
   * DB round-trip on every keystroke — drafts only matter while the
   * intervention is pending (10 min cap), and the canonical pluginState
   * mirror is enough to survive HMR / panel re-mounts.
   *
   * `askUserDraft` is irrelevant after submit (the form unmounts), so we
   * don't bother clearing it — it stays buried under `askUserAnswers` in
   * `pluginState` and never affects the completed Render.
   */
  setInterventionDraft = (toolMessageId: string, draft: Record<string, unknown>): void => {
    this.#get().internal_dispatchMessage({
      id: toolMessageId,
      key: 'askUserDraft',
      type: 'updatePluginState',
      value: draft,
    });
  };

  /**
   * Persist the structured intervention answers (`{ questionText:
   * selectedLabel | selectedLabel[] }`) to the tool message's
   * `pluginState.askUserAnswers`. Drives structured Q&A rendering on the
   * `Render` component without re-parsing the bridge's prose tool_result.
   *
   * Both writes are merge-style by key — the in-memory `updatePluginState`
   * reducer (`message/reducer.ts:142`) and the DB
   * `messageModel.updatePluginState` shallow-merge so co-existing keys
   * (`askUserDraft` etc.) survive. DB write is best-effort: a slow lambda
   * must not strand the IPC submit that follows.
   */
  setInterventionAnswers = async (
    toolMessageId: string,
    answers: Record<string, unknown>,
    context?: OptimisticUpdateContext,
  ): Promise<void> => {
    this.#get().internal_dispatchMessage(
      {
        id: toolMessageId,
        key: 'askUserAnswers',
        type: 'updatePluginState',
        value: answers,
      },
      context,
    );
    try {
      const { messageService } = await import('@/services/message');
      const ctx = this.#get().internal_getConversationContext(context);
      await messageService.updateMessagePluginState(
        toolMessageId,
        { askUserAnswers: answers },
        ctx,
      );
    } catch (err) {
      console.warn('[setInterventionAnswers] persist failed:', err);
    }
  };

  rejectToolCalling = async (
    messageId: string,
    reason?: string,
    context?: ConversationContext,
  ): Promise<void> => {
    const { startOperation, completeOperation } = this.#get();

    // Build effective context from provided context or global state
    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    const toolMessage = dbMessageSelectors.getDbMessageById(messageId)(this.#get());
    if (!toolMessage) return;

    // Create an operation to carry the context for optimistic updates
    const { operationId } = startOperation({
      type: 'rejectToolCalling',
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId,
      },
    });

    const optimisticContext = { operationId };
    const shouldUseGatewayResume = this.#shouldUseGatewayResume(effectiveContext);

    if (!shouldUseGatewayResume) this.#writeTopicStatus(effectiveContext, 'active');

    const toolContent = !!reason
      ? `User reject this tool calling with reason: ${reason}`
      : 'User reject this tool calling without reason';
    if (!shouldUseGatewayResume) {
      await this.#get().optimisticUpdateMessagePlugin(
        toolMessage.id,
        { intervention: { rejectedReason: reason, status: 'rejected' } },
        optimisticContext,
      );
      await this.#get().optimisticUpdateMessageContent(
        messageId,
        toolContent,
        undefined,
        optimisticContext,
      );
    }
    const requestMetadata = this.#getRequestMetadataFromMessageChain(messageId);

    // Server-mode: start a **new** Gateway op carrying the rejection.
    // We use `rejected_continue` uniformly — server-side `rejected` and
    // `rejected_continue` share the same code path (both surface the
    // rejection to the LLM as user feedback), so a separate `rejected`
    // decision adds complexity without behavioural difference.
    if (shouldUseGatewayResume) {
      const toolCallId = toolMessage.tool_call_id;
      if (!toolCallId) {
        console.warn(
          '[rejectToolCalling][server] tool message missing tool_call_id; skipping resume',
        );
        completeOperation(operationId);
        return;
      }
      const pausedOpIds = this.#getRunningServerOps(effectiveContext).map((op) => op.id);
      try {
        const sourceResolution = await this.tryResolveAgentInterventionBySource({
          action: { reason, type: 'reject_continue' },
          context: effectiveContext,
          toolMessageIds: [messageId],
        });
        if (this.#discardAlreadyResolvedSource(sourceResolution, operationId)) return;

        // Park → resume: the new gateway op continues the run paused on this tool.
        this.#emitRunResumed(effectiveContext, {
          operationId,
          parentMessageId: messageId,
          runtimeType: 'gateway',
        });
        if (sourceResolution.handled) {
          if (sourceResolution.execution) {
            await this.#get().executeGatewayAgent({
              context: effectiveContext,
              message: '',
              metadata: requestMetadata,
              parentMessageId: messageId,
              precreatedResult: sourceResolution.execution,
            });
          }
        } else {
          await this.#get().executeGatewayAgent({
            context: effectiveContext,
            message: '',
            metadata: requestMetadata,
            parentMessageId: messageId,
            resumeApproval: {
              decision: 'rejected_continue',
              parentMessageId: messageId,
              rejectionReason: reason,
              toolCallId,
            },
          });
        }
        this.#writeTopicStatus(effectiveContext, 'active');
        this.#completeOpsById(pausedOpIds);
      } catch (error) {
        const err = error as Error;
        console.error('[rejectToolCalling][server] Gateway resume failed:', err);
        this.#get().failOperation(operationId, {
          type: 'rejectToolCalling',
          message: err.message || 'Unknown error',
        });
        throw error;
      }
    }

    completeOperation(operationId);
  };

  rejectAndContinueToolCalling = async (
    messageId: string,
    reason?: string,
    context?: ConversationContext,
  ): Promise<void> => {
    const toolMessage = dbMessageSelectors.getDbMessageById(messageId)(this.#get());
    if (!toolMessage) return;

    const { executeClientAgent, startOperation, completeOperation } = this.#get();

    // Build effective context from provided context or global state
    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };

    const { agentId, topicId, threadId, scope } = effectiveContext;

    // Server-mode: start a **new** Gateway op with `decision='rejected_continue'`.
    // Server persists the rejection on the target tool message and resumes
    // the LLM loop with the rejection content surfaced as user feedback.
    // Skip the client-mode `rejectToolCalling` chain below — that would fire
    // a duplicate halting `reject` before this continue signal.
    if (this.#shouldUseGatewayResume(effectiveContext)) {
      const requestMetadata = this.#getRequestMetadataFromMessageChain(messageId);
      const toolCallId = toolMessage.tool_call_id;
      if (!toolCallId) {
        console.warn(
          '[rejectAndContinueToolCalling][server] tool message missing tool_call_id; skipping resume',
        );
        return;
      }

      const pausedOpIds = this.#getRunningServerOps(effectiveContext).map((op) => op.id);

      const { operationId } = startOperation({
        type: 'rejectToolCalling',
        context: {
          agentId,
          topicId: topicId ?? undefined,
          threadId: threadId ?? undefined,
          scope,
          messageId,
        },
      });

      try {
        const sourceResolution = await this.tryResolveAgentInterventionBySource({
          action: { reason, type: 'reject_continue' },
          context: effectiveContext,
          toolMessageIds: [messageId],
        });
        if (this.#discardAlreadyResolvedSource(sourceResolution, operationId)) return;

        // Park → resume: the new gateway op continues the run paused on this tool.
        this.#emitRunResumed(effectiveContext, {
          operationId,
          parentMessageId: messageId,
          runtimeType: 'gateway',
        });
        if (sourceResolution.handled) {
          if (sourceResolution.execution) {
            await this.#get().executeGatewayAgent({
              context: effectiveContext,
              message: '',
              metadata: requestMetadata,
              parentMessageId: messageId,
              precreatedResult: sourceResolution.execution,
            });
          }
        } else {
          await this.#get().executeGatewayAgent({
            context: effectiveContext,
            message: '',
            metadata: requestMetadata,
            parentMessageId: messageId,
            resumeApproval: {
              decision: 'rejected_continue',
              parentMessageId: messageId,
              rejectionReason: reason,
              toolCallId,
            },
          });
        }
        this.#writeTopicStatus(effectiveContext, 'active');
        this.#completeOpsById(pausedOpIds);
        completeOperation(operationId);
      } catch (error) {
        const err = error as Error;
        console.error('[rejectAndContinueToolCalling][server] Gateway resume failed:', err);
        this.#get().failOperation(operationId, {
          type: 'rejectToolCalling',
          message: err.message || 'Unknown error',
        });
        throw error;
      }
      return;
    }

    // Client-mode path: reject first (persists rejection + updates content),
    // then spin up a local runtime with phase='user_input' to continue.
    await this.#get().rejectToolCalling(messageId, reason, context);

    // Create an operation to manage the continue execution
    const { operationId } = startOperation({
      type: 'rejectToolCalling',
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId,
      },
    });

    // Park → resume: this local op continues the run paused on the rejected tool.
    this.#emitRunResumed(effectiveContext, {
      operationId,
      parentMessageId: messageId,
      runtimeType: 'client',
    });

    // Get current messages for state construction using context
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());
    const requestMetadata = this.#getRequestMetadataFromMessageChain(messageId, currentMessages);

    // Create agent state and context to continue from rejected tool message
    const { state, context: initialContext } = this.#get().internal_createAgentState({
      messages: currentMessages,
      parentMessageId: messageId,
      agentId,
      topicId,
      threadId: threadId ?? undefined,
      operationId,
    });

    // Override context with 'userInput' phase to continue as if user provided feedback
    const agentRuntimeContext: AgentRuntimeContext = {
      ...initialContext,
      phase: 'user_input',
    };

    // Execute agent runtime from rejected tool message position to continue
    try {
      await executeClientAgent({
        context: effectiveContext,
        messages: currentMessages,
        parentMessageId: messageId,
        parentMessageType: 'tool',
        initialState: state,
        initialContext: agentRuntimeContext,
        metadata: requestMetadata,
        // Pass parent operation ID to establish parent-child relationship
        parentOperationId: operationId,
      });
      completeOperation(operationId);
    } catch (error) {
      const err = error as Error;
      console.error('[rejectAndContinueToolCalling] Error executing agent runtime:', err);
      this.#get().failOperation(operationId, {
        type: 'rejectToolCalling',
        message: err.message || 'Unknown error',
      });
    }
  };
}

export type ConversationControlAction = Pick<
  ConversationControlActionImpl,
  keyof ConversationControlActionImpl
>;
