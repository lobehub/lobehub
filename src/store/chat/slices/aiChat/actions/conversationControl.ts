// Disable the auto sort key eslint rule to make the code more logic and readable
import { type AgentRuntimeContext } from '@lobechat/agent-runtime';
import { MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import {
  type ConversationContext,
  type MessageMetadata,
  type UIChatMessage,
} from '@lobechat/types';

import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { selectRuntimeType } from '@/store/chat/slices/aiChat/actions/agentDispatcher';
import { operationSelectors } from '@/store/chat/slices/operation/selectors';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation/types';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

import { displayMessageSelectors } from '../../../selectors';
import { messageMapKey } from '../../../utils/messageMapKey';
import { type OptimisticUpdateContext } from '../../message/actions/optimisticUpdate';
import { dbMessageSelectors } from '../../message/selectors';

/**
 * Actions for controlling conversation operations like cancellation and error handling
 */

type Setter = StoreSetter<ChatStore>;
export const conversationControl = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new ConversationControlActionImpl(set, get, _api);

export class ConversationControlActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  /**
   * Decide whether approve/reject/reject_continue should go through the
   * Gateway resume path (new op carrying `resumeApproval`) instead of the
   * local `executeClientAgent` path. Mirrors the "interrupt + new op"
   * pattern from LOBE-7142.
   *
   * Routes via `selectRuntimeType` so approve/reject align with how the
   * conversation was dispatched at sendMessage time. Hetero resume is not yet
   * implemented and falls through to client local resume — see LOBE-8519.
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
        heterogeneousProvider: agentConfig?.agencyConfig?.heterogeneousProvider,
        isGatewayMode: this.#get().isGatewayModeEnabled(),
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

  /**
   * Local tool-interaction resumes are continuations of the original request.
   * Preserve the request trigger so downstream chat requests keep the same
   * headers after a human-intervention pause.
   */
  #getRequestMetadataFromMessageChain = (
    messages: UIChatMessage[],
    anchorMessageId: string,
  ): Pick<MessageMetadata, 'trigger'> | undefined => {
    const messagesById = new Map(messages.map((message) => [message.id, message]));
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

  cancelSendMessageInServer = (topicId?: string): void => {
    const { activeAgentId, activeTopicId } = this.#get();

    // Determine which operation to cancel
    const targetTopicId = topicId ?? activeTopicId;
    const contextKey = messageMapKey({ agentId: activeAgentId, topicId: targetTopicId });

    // Cancel operations in the operation system
    const operationIds = this.#get().operationsByContext[contextKey] || [];

    operationIds.forEach((opId) => {
      const operation = this.#get().operations[opId];
      if (operation && operation.type === 'sendMessage' && operation.status === 'running') {
        this.#get().cancelOperation(opId, 'User cancelled');
      }
    });

    // Restore editor state if it's the active session
    if (contextKey === messageMapKey({ agentId: activeAgentId, topicId: activeTopicId })) {
      // Find the latest sendMessage operation with editor state
      for (const opId of [...operationIds].reverse()) {
        const op = this.#get().operations[opId];
        if (op && op.type === 'sendMessage' && op.metadata.inputEditorTempState) {
          this.#get().mainInputEditor?.setJSONState(op.metadata.inputEditorTempState);
          break;
        }
      }
    }
  };

  clearSendMessageError = (): void => {
    const { activeAgentId, activeTopicId } = this.#get();
    const contextKey = messageMapKey({ agentId: activeAgentId, topicId: activeTopicId });
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

  approveToolCalling = async (
    toolMessageId: string,
    _assistantGroupId: string,
    context?: ConversationContext,
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
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId: toolMessageId,
      },
    });

    const optimisticContext = { operationId };

    // 2. Update intervention status to approved
    await this.#get().optimisticUpdateMessagePlugin(
      toolMessageId,
      { intervention: { status: 'approved' } },
      optimisticContext,
    );

    // 2.5. Server-mode: start a **new** Gateway op carrying the approval
    // decision via `resumeApproval`. The server reads the target tool
    // message, persists `intervention=approved`, dispatches the approved
    // tool, and streams results back on the new op. No in-place resume of
    // the paused op — simpler state + avoids stepIndex races.
    if (this.#shouldUseGatewayResume(effectiveContext)) {
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
        await this.#get().executeGatewayAgent({
          context: effectiveContext,
          message: '',
          parentMessageId: toolMessageId,
          resumeApproval: {
            decision: 'approved',
            parentMessageId: toolMessageId,
            toolCallId,
          },
        });
        this.#completeOpsById(pausedOpIds);
        completeOperation(operationId);
      } catch (error) {
        const err = error as Error;
        console.error('[approveToolCalling][server] Gateway resume failed:', err);
        this.#get().failOperation(operationId, {
          type: 'approveToolCalling',
          message: err.message || 'Unknown error',
        });
      }
      return;
    }

    // 3. Get current messages for state construction using context
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());
    const requestMetadata = this.#getRequestMetadataFromMessageChain(
      currentMessages,
      toolMessageId,
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
        metadata: requestMetadata,
        // Pass parent operation ID to establish parent-child relationship
        // This ensures proper cancellation propagation
        parentOperationId: operationId,
      });
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

  submitToolInteraction = async (
    toolMessageId: string,
    response: Record<string, unknown>,
    context?: ConversationContext,
    options?: {
      createUserMessage?: boolean;
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
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId: toolMessageId,
      },
    });

    const optimisticContext: OptimisticUpdateContext = { operationId };
    const shouldCreateUserMessage = options?.createUserMessage !== false;

    // 1. Mark intervention as approved and set tool result to user's response
    await this.#get().optimisticUpdateMessagePlugin(
      toolMessageId,
      { intervention: { status: 'approved' } },
      optimisticContext,
    );

    const toolContent = options?.toolResultContent ?? `User submitted: ${JSON.stringify(response)}`;
    await this.#get().optimisticUpdateMessageContent(
      toolMessageId,
      toolContent,
      undefined,
      optimisticContext,
    );

    if (options?.pluginState) {
      await this.#get().optimisticUpdatePluginState(
        toolMessageId,
        options.pluginState,
        optimisticContext,
      );
    }

    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });

    // 2a. Tool-result-only path: skip the synthetic user message and resume from the
    // tool message. Used by interventions whose UI handles its own side effect (e.g.
    // the agent marketplace picker forks agents directly) — the LLM should see the
    // tool result, not a fake user turn.
    if (!shouldCreateUserMessage) {
      const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());
      const requestMetadata = this.#getRequestMetadataFromMessageChain(
        currentMessages,
        toolMessageId,
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
    const userMessageContent = Object.values(response).join(', ');
    const groupId = toolMessage.groupId;
    const userMsg = await this.#get().optimisticCreateMessage(
      {
        agentId: agentId!,
        content: userMessageContent,
        groupId: groupId ?? undefined,
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

    // 3. Resume agent from user message (not tool re-execution)
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());
    const requestMetadata = this.#getRequestMetadataFromMessageChain(
      currentMessages,
      toolMessageId,
    );

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
      context: {
        agentId,
        topicId: topicId ?? undefined,
        threadId: threadId ?? undefined,
        scope,
        messageId: toolMessageId,
      },
    });

    const optimisticContext: OptimisticUpdateContext = { operationId };

    // 1. Mark intervention as rejected (skipped) with reason
    await this.#get().optimisticUpdateMessagePlugin(
      toolMessageId,
      { intervention: { rejectedReason: reason, status: 'rejected' } },
      optimisticContext,
    );

    const toolContent = reason ? `User skipped: ${reason}` : 'User skipped this question.';
    await this.#get().optimisticUpdateMessageContent(
      toolMessageId,
      toolContent,
      undefined,
      optimisticContext,
    );

    // 2. Create a user message indicating the skip
    const userMessageContent = reason ? `I'll skip this. ${reason}` : "I'll skip this.";
    const groupId = toolMessage.groupId;
    const userMsg = await this.#get().optimisticCreateMessage(
      {
        agentId: agentId!,
        content: userMessageContent,
        groupId: groupId ?? undefined,
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

    // 3. Resume agent from user message
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());
    const requestMetadata = this.#getRequestMetadataFromMessageChain(
      currentMessages,
      toolMessageId,
    );

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
   * stamp `pluginIntervention.status` and the eventual `tool_result`
   * content via the same optimistic primitives, so the InterventionBar /
   * inline tool body update synchronously and the answered Render takes
   * over once `pluginIntervention.status === 'approved' | 'rejected'`.
   *
   * `actionType`:
   *   - `'submit'` → mark approved, ship `payload` as the answer
   *   - `'skip' | 'cancel'` → mark rejected, ship `cancelled: true` so the
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

    // Walk up to the assistant that owns this tool — its operation is the
    // running CC stream we need to address. Falls through to the tool
    // message id itself if a producer ever associated it directly.
    const { messageOperationMap } = this.#get();
    const operationId =
      (toolMessage.parentId && messageOperationMap?.[toolMessage.parentId]) ??
      messageOperationMap?.[toolMessageId];

    if (!operationId) {
      console.warn('[submitHeteroIntervention] no operationId for', toolMessageId);
      return;
    }

    const effectiveContext: ConversationContext = context ?? {
      agentId: this.#get().activeAgentId,
      topicId: this.#get().activeTopicId,
      threadId: this.#get().activeThreadId,
    };
    // If the operation has already been garbage-collected (e.g. the bridge
    // timed out earlier and `runtime_end` rolled the op into `completed`
    // 30s+ ago), don't pass the stale opId into the optimistic chain — the
    // `internal_getConversationContext` fallback uses global state, which
    // matches the active conversation the user just clicked in. The IPC
    // submit below stays unchanged: `bridge.resolve()` no-ops on unknown
    // toolCallIds, so it's safe to fire even when the bridge is gone.
    const operationAlive = !!this.#get().operations[operationId];
    if (!operationAlive) {
      console.warn(
        '[submitHeteroIntervention] operation already gone, using global-state fallback for optimistic write:',
        operationId,
      );
    }
    const optimisticContext: OptimisticUpdateContext = operationAlive ? { operationId } : {};

    if (actionType === 'submit') {
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
        { intervention: { rejectedReason: reason, status: 'rejected' } },
        optimisticContext,
      );
      await this.#get().optimisticUpdateMessageContent(
        toolMessageId,
        `${reason} this interaction.`,
        undefined,
        optimisticContext,
      );
    }

    // Forward to the producer (Electron main → bridge.resolve). Dynamic
    // import keeps `@/services/electron/*` out of non-Electron bundles.
    try {
      const { heterogeneousAgentService } = await import('@/services/electron/heterogeneousAgent');
      await heterogeneousAgentService.submitIntervention(
        actionType === 'submit'
          ? { operationId, result: payload ?? {}, toolCallId }
          : {
              cancelReason: actionType === 'skip' ? 'user_cancelled' : 'user_cancelled',
              cancelled: true,
              operationId,
              toolCallId,
            },
      );
    } catch (err) {
      console.error('[submitHeteroIntervention] IPC submitIntervention failed:', err);
    }

    void effectiveContext;
  };

  /**
   * In-memory draft store for an intervention form. Backs the renderer's
   * "remember what I'd partially answered" behaviour without paying for a
   * DB round-trip on every keystroke — drafts only matter while the
   * intervention is pending (5 min cap), and the canonical pluginState
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

    // Optimistic update - update status to rejected and save reason
    const intervention = {
      rejectedReason: reason,
      status: 'rejected',
    } as const;
    await this.#get().optimisticUpdateMessagePlugin(
      toolMessage.id,
      { intervention },
      optimisticContext,
    );

    const toolContent = !!reason
      ? `User reject this tool calling with reason: ${reason}`
      : 'User reject this tool calling without reason';

    await this.#get().optimisticUpdateMessageContent(
      messageId,
      toolContent,
      undefined,
      optimisticContext,
    );

    // Server-mode: start a **new** Gateway op carrying the rejection.
    // We use `rejected_continue` uniformly — server-side `rejected` and
    // `rejected_continue` share the same code path (both surface the
    // rejection to the LLM as user feedback), so a separate `rejected`
    // decision adds complexity without behavioural difference.
    if (this.#shouldUseGatewayResume(effectiveContext)) {
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
        await this.#get().executeGatewayAgent({
          context: effectiveContext,
          message: '',
          parentMessageId: messageId,
          resumeApproval: {
            decision: 'rejected_continue',
            parentMessageId: messageId,
            rejectionReason: reason,
            toolCallId,
          },
        });
        this.#completeOpsById(pausedOpIds);
      } catch (error) {
        console.error('[rejectToolCalling][server] Gateway resume failed:', error);
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

      const optimisticContext = { operationId };
      await this.#get().optimisticUpdateMessagePlugin(
        messageId,
        { intervention: { rejectedReason: reason, status: 'rejected' } as any },
        optimisticContext,
      );
      const toolContent = reason
        ? `User reject this tool calling with reason: ${reason}`
        : 'User reject this tool calling without reason';
      await this.#get().optimisticUpdateMessageContent(
        messageId,
        toolContent,
        undefined,
        optimisticContext,
      );

      try {
        await this.#get().executeGatewayAgent({
          context: effectiveContext,
          message: '',
          parentMessageId: messageId,
          resumeApproval: {
            decision: 'rejected_continue',
            parentMessageId: messageId,
            rejectionReason: reason,
            toolCallId,
          },
        });
        this.#completeOpsById(pausedOpIds);
        completeOperation(operationId);
      } catch (error) {
        const err = error as Error;
        console.error('[rejectAndContinueToolCalling][server] Gateway resume failed:', err);
        this.#get().failOperation(operationId, {
          type: 'rejectToolCalling',
          message: err.message || 'Unknown error',
        });
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

    // Get current messages for state construction using context
    const chatKey = messageMapKey({ agentId, topicId, threadId, scope });
    const currentMessages = displayMessageSelectors.getDisplayMessagesByKey(chatKey)(this.#get());
    const requestMetadata = this.#getRequestMetadataFromMessageChain(currentMessages, messageId);

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
