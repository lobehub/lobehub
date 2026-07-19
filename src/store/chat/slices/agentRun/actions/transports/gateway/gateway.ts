import {
  AgentStreamClient,
  type AgentStreamClientOptions,
  type AgentStreamEvent,
  type ConnectionStatus,
} from '@lobechat/agent-gateway-client';
import type {
  ChatTopicMetadata,
  ConversationContext,
  ExecAgentResult,
  MessageMetadata,
  RuntimeMentionedAgent,
} from '@lobechat/types';

import { isDesktop } from '@/const/version';
import {
  aiAgentService,
  type ResumeApprovalParam,
  type ResumeToolResultParam,
} from '@/services/aiAgent';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { getAgentStoreState } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { consumePendingTopicRepos, getPendingTopicRepos } from '@/store/chat/pendingTopicRepos';
import { topicSelectors } from '@/store/chat/selectors';
import type { ChatStore } from '@/store/chat/store';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { topicMapKey } from '@/store/chat/utils/topicMapKey';
import type { StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';
import { settingsSelectors, toolInterventionSelectors } from '@/store/user/selectors';
import { isTrpcErrorCode } from '@/utils/trpcError';

import { buildRunLifecycle } from '../../lifecycle/buildRunLifecycle';
import type { RunScope } from '../../lifecycle/types';
import { createGatewayEventHandler, isCompletedRuntimeEnd } from './gatewayEventHandler';
import { createGatewayEventRouter } from './gatewayEventRouter';
import { createGatewayMemberStreamHandler } from './gatewayMemberStreamHandler';

/**
 * When the agent runs against the local machine, resolve this desktop's
 * own gateway deviceId so it can be passed as the run's `deviceId`. The server
 * then presets `activeDeviceId` and injects `lobe-local-system` into the very
 * first LLM payload — skipping the extra `activateDevice` round-trip the model
 * is otherwise forced to make whenever more than one device is online (with a
 * single device the server's heuristic already covered it).
 *
 * Gated on the effective runtime mode (`isLocalSystemEnabledById`), which
 * derives from `agencyConfig.executionTarget` — only a `local` target presets
 * the device. Resolving a device for `sandbox` / `none` / `device` targets
 * would wrongly route the run to this machine.
 *
 * Desktop-only and best-effort: any failure falls back to the server-side
 * device-resolution heuristics. We don't pre-check online status here — an
 * offline id simply fails the server's `onlineDevices` guard and stays unrouted.
 */
const resolveLocalDeviceId = async (agentId?: string): Promise<string | undefined> => {
  if (!isDesktop || !agentId) return undefined;

  const agentState = getAgentStoreState();
  // Chat mode means "no execution environment" — never resolve a device, even
  // when the target is `local`. The server enforces this too (it auto-activates
  // a single online device), but skipping the deviceId round-trip here avoids
  // sending an id the server would only discard.
  if (chatConfigByIdSelectors.isChatModeById(agentId)(agentState)) return undefined;

  const isLocal = chatConfigByIdSelectors.isLocalSystemEnabledById(agentId)(agentState);
  if (!isLocal) return undefined;

  try {
    const info = await gatewayConnectionService.getDeviceInfo();
    return info?.deviceId;
  } catch {
    return undefined;
  }
};

type Setter = StoreSetter<ChatStore>;

// ─── Types ───

export interface GatewayConnection {
  client: Pick<
    AgentStreamClient,
    | 'connect'
    | 'disconnect'
    | 'on'
    | 'reconnect'
    | 'sendInterrupt'
    | 'sendToolResult'
    | 'updateToken'
  >;
  status: ConnectionStatus;
}

export interface ConnectGatewayParams {
  /**
   * Gateway WebSocket URL (e.g. https://agent-gateway.lobehub.com)
   */
  gatewayUrl: string;
  /**
   * Callback for each agent event received
   */
  onEvent?: (event: AgentStreamEvent) => void;
  /**
   * Called when the session completes (agent_runtime_end or session_complete).
   *
   * `succeeded` is true only for a clean `agent_runtime_end`; callers use it to
   * avoid stomping the `unread` status a background completion writes (the
   * completion's `markTopicUnread` and this terminal `active` write
   * partition the cases by `succeeded && !viewing`).
   *
   * `terminalReceived` is true when a terminal agent event (`agent_runtime_end` /
   * `error`) was processed — meaning the gateway event handler already completed
   * the op via the shared run lifecycle, so `onSessionComplete` is pure transport
   * cleanup. When false (terminal-missing: `session_complete` / `auth_failed` /
   * token-refresh failure arrived with no terminal agent event), the callback must
   * itself complete the op as the explicit fallback so it never sticks `running`.
   *
   * `authFailed` is true when the close was driven by the gateway rejecting auth
   * (`auth_failed`, or a failed `auth_expired` token refresh) — an authoritative
   * "this op no longer exists on the server" signal. Reconnect callers use it to
   * distinguish a genuinely-dead op (clear the persisted marker) from a bare
   * `resume_complete` terminal status, which can fire for a still-running op the
   * gateway DO has no live session for (e.g. heterogeneous CC) and must NOT clear.
   */
  onSessionComplete?: (info: {
    authFailed: boolean;
    succeeded: boolean;
    terminalReceived: boolean;
  }) => void;
  /**
   * The operation ID returned by execAgent
   */
  operationId: string;
  /**
   * Enable resume buffering for reconnect scenarios (default: false)
   */
  resumeOnConnect?: boolean;
  /**
   * Auth token for the Gateway
   */
  token: string;
  /**
   * Topic this op runs against. Used to refresh the Gateway JWT via
   * `aiAgentService.refreshGatewayToken(topicId)` when the server signals
   * `auth_expired`. Every Gateway op has a topic, so this is required.
   */
  topicId: string;
}

// ─── Action Implementation ───

export class GatewayActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  /** Overridable factory for testing */
  createClient: (options: AgentStreamClientOptions) => GatewayConnection['client'] = (options) =>
    new AgentStreamClient(options);

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  /**
   * Connect to the Agent Gateway for a specific operation.
   * Creates an AgentStreamClient, manages its lifecycle, and wires up event callbacks.
   */
  connectToGateway = (params: ConnectGatewayParams): void => {
    const { operationId, gatewayUrl, token, topicId, onEvent, onSessionComplete, resumeOnConnect } =
      params;

    // Disconnect existing connection for this operation if any
    this.disconnectFromGateway(operationId);

    const client = this.createClient({ gatewayUrl, operationId, resumeOnConnect, token });

    // Track connection in store
    this.#set(
      (state) => ({
        gatewayConnections: {
          ...state.gatewayConnections,
          [operationId]: { client, status: 'connecting' },
        },
      }),
      false,
      'connectToGateway',
    );

    // Wire up status changes
    client.on('status_changed', (status) => {
      this.#set(
        (state) => {
          const conn = state.gatewayConnections[operationId];
          if (!conn) return state;
          return {
            gatewayConnections: { ...state.gatewayConnections, [operationId]: { ...conn, status } },
          };
        },
        false,
        'gateway/statusChanged',
      );
    });

    // Track whether a terminal agent event was received (agent_runtime_end or error),
    // so we can fire onSessionComplete from the subsequent disconnect.
    // session_complete is handled separately as an explicit server signal.
    let receivedTerminalEvent = false;
    let terminalSucceeded = false;
    let sessionCompleted = false;
    const fireSessionComplete = (opts?: { authFailed?: boolean }) => {
      if (sessionCompleted) return;
      sessionCompleted = true;
      onSessionComplete?.({
        authFailed: opts?.authFailed ?? false,
        succeeded: terminalSucceeded,
        terminalReceived: receivedTerminalEvent,
      });
    };

    // Forward agent events to caller, and track terminal events.
    //
    // Only THIS op's terminal counts. On a multiplexed connection the
    // supervisor's WS also carries forwarded member terminals; a member
    // finishing must not mark the supervisor run complete or stomp its unread
    // status. Match on the event's operationId (absent ⇒ legacy single-op WS,
    // treat as this op's to preserve prior behavior).
    client.on('agent_event', (event) => {
      const isOwnOp = !event.operationId || event.operationId === operationId;
      if (isOwnOp && (event.type === 'agent_runtime_end' || event.type === 'error')) {
        receivedTerminalEvent = true;
      }
      // Only a clean completion counts as success — a cancel ('interrupted') or
      // deferred-tool park ('waiting_for_async_tool') must take the non-success
      // branch so onSessionComplete clears the run back to 'active' instead of
      // leaving the topic persisted as an unread completion.
      if (
        isOwnOp &&
        event.type === 'agent_runtime_end' &&
        isCompletedRuntimeEnd((event.data as { reason?: string } | undefined)?.reason)
      ) {
        terminalSucceeded = true;
      }
      onEvent?.(event);
    });

    // Handle session completion
    client.on('session_complete', () => {
      this.internal_cleanupGatewayConnection(operationId);
      fireSessionComplete();
    });

    // Handle disconnection — only fire session complete if a terminal agent event
    // was received (agent_runtime_end / error). Explicit disconnect() and other
    // non-terminal disconnects should NOT trigger onSessionComplete.
    // (auth_failed is handled separately below — it's also session-terminal.)
    client.on('disconnected', () => {
      this.internal_cleanupGatewayConnection(operationId);
      if (receivedTerminalEvent) {
        fireSessionComplete();
      }
    });

    // Handle auth failures — server-side terminal: the op no longer exists on
    // the server (GC'd, token rejected, etc.), so the local op must be marked
    // complete. Without this, the local op stays `running` forever and the
    // input stop button never clears; worse, `topic.metadata.runningOperation`
    // never gets cleared either, so each revisit re-triggers the same broken
    // reconnect.
    client.on('auth_failed', (reason) => {
      console.error(`[Gateway] Auth failed for operation ${operationId}: ${reason}`);
      this.internal_cleanupGatewayConnection(operationId);
      fireSessionComplete({ authFailed: true });
    });

    // Handle expired-but-recoverable auth: the JWT is past `exp` but the op
    // is still alive on the server. Refresh the token, hand it to the client,
    // and reconnect. If the refresh itself fails (refresh API down, server
    // refused refresh, etc.), fall back to terminal — leaving the op
    // `running` would freeze the input. The server keeps the ws open after
    // `auth_expired` to give the client a chance to recover, so we must
    // explicitly `disconnect()` before completing — otherwise heartbeat and
    // autoReconnect would keep running past the local op's lifetime.
    client.on('auth_expired', async () => {
      try {
        const { token: fresh } = await aiAgentService.refreshGatewayToken(topicId);
        client.updateToken(fresh);
        await client.reconnect();
      } catch (error) {
        console.error(`[Gateway] Token refresh failed for operation ${operationId}:`, error);
        client.disconnect();
        this.internal_cleanupGatewayConnection(operationId);
        // A rejected refresh means the gateway no longer accepts this op's token
        // — treat it like auth_failed so reconnect callers clear the stale marker.
        fireSessionComplete({ authFailed: true });
      }
    });

    client.connect();
  };

  /**
   * Disconnect from the Gateway for a specific operation.
   */
  disconnectFromGateway = (operationId: string): void => {
    const conn = this.#get().gatewayConnections[operationId];
    if (!conn) return;

    conn.client.disconnect();
    this.internal_cleanupGatewayConnection(operationId);
  };

  /**
   * Send an interrupt command to stop the agent for a specific operation.
   */
  interruptGatewayAgent = (operationId: string): void => {
    const conn = this.#get().gatewayConnections[operationId];
    if (!conn) return;

    conn.client.sendInterrupt();
  };

  /**
   * Get the connection status for a specific operation.
   */
  getGatewayConnectionStatus = (operationId: string): ConnectionStatus | undefined => {
    return this.#get().gatewayConnections[operationId]?.status;
  };

  /**
   * Check if Gateway mode is available and enabled.
   * Returns true when the server supports Gateway mode and the agent config
   * has not disabled it. `disableGatewayMode: undefined` means enabled.
   */
  isGatewayModeEnabled = (agentId?: string): boolean => {
    const serverConfig = window.global_serverConfigStore?.getState()?.serverConfig;
    const agentState = getAgentStoreState();
    const resolvedAgentId = agentId ?? agentState.activeAgentId;
    const agentDisableGatewayMode = resolvedAgentId
      ? chatConfigByIdSelectors.getChatConfigById(resolvedAgentId)(agentState).disableGatewayMode
      : undefined;
    const defaultDisableGatewayMode = settingsSelectors.defaultAgentConfig(useUserStore.getState())
      .chatConfig?.disableGatewayMode;
    const disableGatewayMode = agentDisableGatewayMode ?? defaultDisableGatewayMode;

    return (
      !!serverConfig?.agentGatewayUrl &&
      !!serverConfig.enableGatewayMode &&
      disableGatewayMode !== true
    );
  };

  /**
   * Execute agent task via Gateway WebSocket.
   * Call isGatewayModeEnabled() first to check availability.
   */
  /**
   * Execute agent task via Gateway WebSocket.
   * The backend creates user + assistant messages and the topic (if needed).
   * Returns the result so the caller can handle topic switching.
   */
  /**
   * Execute agent task via Gateway WebSocket.
   * The backend creates user + assistant messages and the topic (if needed),
   * then starts the agent. This method handles topic switching and WebSocket connection.
   */
  executeGatewayAgent = async (params: {
    context: ConversationContext;
    /** File IDs of already-uploaded attachments to attach to the new user message */
    fileIds?: string[];
    message: string;
    /** Request metadata carried from the originating user message. */
    metadata?: Pick<MessageMetadata, 'trigger'>;
    /** Called when the gateway session completes (agent finished running) */
    onComplete?: () => void;
    /** Temporary sidebar topic inserted by sendMessage before the server creates the real topic. */
    optimisticTopic?: { id: string; metadata?: ChatTopicMetadata; title: string };
    /** Parent message ID for regeneration/continue (skip user message creation, branch from this message) */
    parentMessageId?: string;
    /**
     * Caller-owned operation that should be completed once the gateway side
     * has finished phase-1 init (network round-trip + child
     * `execServerAgentRuntime` op started). Lets the caller keep its own
     * loading state running through `execAgentTask` without any gap before
     * the child op takes over. The relationship is also recorded as
     * parent/child lineage on the new op.
     */
    parentOperationId?: string;
    /**
     * Resume a paused op waiting on `human_approve_required`. Forwarded to
     * `aiAgentService.execAgentTask` so the new server-side op knows to apply
     * the user's decision to the target tool message instead of starting from
     * a fresh user prompt.
     */
    resumeApproval?: ResumeApprovalParam;
    /**
     * Resume a paused op waiting on a human-intervention tool (e.g. lobe-agent
     * `askUserQuestion`). Forwarded to `aiAgentService.execAgentTask` so the new
     * server-side op writes the human answer as the tool result and resumes from
     * `phase: 'tool_result'` WITHOUT re-executing the tool.
     */
    resumeToolResult?: ResumeToolResultParam;
    /**
     * Tool identifiers the user @-mentioned in this message. Forwarded to the
     * server as `selectedToolIds` so the server runtime enables them for this
     * run (mirrors the client runtime's mention → callable-tool wiring). Lets a
     * user invoke a tool that isn't pinned to the agent (e.g. a custom MCP
     * connector picked from the @ list).
     */
    selectedToolIds?: string[];
    /**
     * Agents the user @-mentioned in this message (multi-mention). Forwarded to
     * the server so the supervisor run enables the callAgent tool and injects the
     * mentioned-agents delegation context — mirrors the client runtime's
     * `initialContext.mentionedAgents` + injected callAgent manifest. Without
     * this the gateway supervisor never sees the mention and answers itself
     * instead of delegating.
     */
    mentionedAgents?: RuntimeMentionedAgent[];
    /**
     * Temporary message IDs created during the initial sendMessage phase.
     * These are associated with the new gateway operation so the UI doesn't
     * show a blank loading state while waiting for the first `step_start`
     * event to call `replaceMessages` with the server's real message IDs.
     */
    tempMessageIds?: string[];
  }): Promise<ExecAgentResult> => {
    const {
      context,
      fileIds,
      message,
      metadata,
      onComplete,
      optimisticTopic,
      parentMessageId,
      parentOperationId,
      resumeApproval,
      resumeToolResult,
      selectedToolIds,
      mentionedAgents,
      tempMessageIds,
    } = params;

    const agentGatewayUrl =
      window.global_serverConfigStore!.getState().serverConfig.agentGatewayUrl!;

    const isCreateNewTopic = !context.topicId;
    const taskId = context.viewedTask?.type === 'detail' ? context.viewedTask.taskId : undefined;

    // If this is a new topic, read any repos the user pre-selected before
    // sending the first message. We read without consuming yet — if execAgentTask
    // fails or is aborted, the selection is preserved so a retry can still pick
    // it up. We clear only after the server confirms the topic was created.
    const pendingRepos =
      isCreateNewTopic && context.agentId ? getPendingTopicRepos(context.agentId) : [];
    // Pending repo selection wins; otherwise carry the caller-resolved topic
    // metadata (e.g. the hetero cwd `conversationLifecycle` resolved from the
    // effective device + per-user legacy slot) so the SERVER topic is born with
    // it — the server can't read client-local state, and without this a
    // workspace hetero run's first send would fall back to the device default
    // cwd instead of the member's pick.
    const initialTopicMetadata =
      pendingRepos.length > 0
        ? {
            repos: pendingRepos,
            workingDirectory: pendingRepos[0],
            workingDirectoryConfig: { path: pendingRepos[0], repoType: 'github' as const },
          }
        : isCreateNewTopic && optimisticTopic?.metadata?.workingDirectory
          ? {
              repos: optimisticTopic.metadata.repos,
              workingDirectory: optimisticTopic.metadata.workingDirectory,
              workingDirectoryConfig: optimisticTopic.metadata.workingDirectoryConfig,
            }
          : undefined;

    // Honour user-initiated cancel during phase-1 init: while we await the
    // execAgentTask round-trip the caller's loading state (e.g. `sendMessage`)
    // is still running, so the ChatInput stop button is active. Forward the
    // signal into the request so the fetch aborts in-flight, and re-check
    // afterwards in case cancel arrived just after the request resolved (the
    // server task is then already created — best-effort interrupt it before
    // bailing out, otherwise the agent run continues server-side).
    const abortSignal = parentOperationId
      ? this.#get().getOperationAbortSignal(parentOperationId)
      : undefined;

    const localDeviceId = await resolveLocalDeviceId(context.agentId);
    const userInterventionConfig = {
      approvalMode: toolInterventionSelectors.approvalMode(useUserStore.getState()),
      allowList: toolInterventionSelectors.allowList(useUserStore.getState()),
    };

    const result = await aiAgentService.execAgentTask(
      {
        agentId: context.agentId,
        appContext: {
          agentDocumentId: context.agentDocumentId,
          defaultTaskAssigneeAgentId: context.defaultTaskAssigneeAgentId,
          documentId: context.documentId,
          // When AgentBuilder runs, context.agentId is the builtin builder agent.
          // The actual editing target is chatStore.activeAgentId (kept in sync by
          // AgentBuilderProvider). Pass it so the server can route tool calls to
          // the correct agent rather than the builder itself.
          ...(context.scope === 'agent_builder' && {
            editingAgentId: this.#get().activeAgentId ?? undefined,
          }),
          groupId: context.groupId,
          ...(initialTopicMetadata && { initialTopicMetadata }),
          // Forward the group orchestration role so the server can stamp it onto
          // the assistant message metadata. Without this the gateway-created
          // supervisor turn loses its role on the step_start snapshot / refetch
          // and renders as a generic assistant.
          orchestrationRole: context.orchestrationRole,
          scope: context.scope,
          taskId,
          threadId: context.threadId,
          topicId: context.topicId,
        },
        deviceId: localDeviceId,
        fileIds,
        mentionedAgents,
        parentMessageId,
        prompt: message,
        resumeApproval,
        resumeToolResult,
        selectedToolIds,
        trigger: metadata?.trigger,
        userInterventionConfig,
      },
      { signal: abortSignal },
    );

    if (abortSignal?.aborted) {
      // Cancel arrived after execAgentTask resolved — server task exists.
      aiAgentService
        .interruptTask({ operationId: result.operationId })
        .catch((err) => console.error('[Gateway] interruptTask after cancel failed:', err));
      throw abortSignal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    // If server created a new topic, fetch messages first then switch topic
    // (same pattern as client mode: replaceMessages before switchTopic to avoid skeleton flash)
    if (isCreateNewTopic && result.topicId) {
      // Topic created successfully — now safe to clear the pending repo selection.
      if (context.agentId) consumePendingTopicRepos(context.agentId);
      if (optimisticTopic) {
        const topicMetadata = optimisticTopic.metadata ?? initialTopicMetadata;
        this.#get().internal_replaceTopicId({
          agentId: context.agentId,
          groupId: context.groupId,
          nextId: result.topicId,
          previousId: optimisticTopic.id,
          value: {
            ...(topicMetadata ? { metadata: topicMetadata } : {}),
            ...(context.groupId ? {} : { sessionId: context.agentId }),
            title: optimisticTopic.title,
          },
        });
      }
      try {
        const newContext = { ...context, topicId: result.topicId };
        const messages = await messageService.getMessages(newContext);
        this.#get().replaceMessages(messages, { context: newContext });
      } catch {
        /* non-critical */
      }

      await this.#get().switchTopic(result.topicId, {
        clearNewKey: true,
        skipRefreshMessage: true,
      });

      // Refresh the topic list so the new topic appears in topicDataMap (sidebar).
      // Unlike the direct-API sendMessage path (which receives topics[] in the
      // response and calls internal_updateTopics), the gateway path only gets a
      // topicId — we must explicitly refetch so the sidebar shows the new topic.
      this.#get()
        .refreshTopic()
        .catch((err) => console.error('[Gateway] refreshTopic after topic creation failed:', err));

      if (abortSignal?.aborted) {
        aiAgentService
          .interruptTask({ operationId: result.operationId })
          .catch((err) => console.error('[Gateway] interruptTask after cancel failed:', err));
        throw abortSignal.reason ?? new DOMException('Aborted', 'AbortError');
      }
    }

    // Use the server-created topicId for the execution context
    const execContext = { ...context, topicId: result.topicId };
    this.#get().moveQueuedMessages(messageMapKey(context), messageMapKey(execContext));

    if (result.topicId) {
      void this.#get().updateTopicStatus?.({
        agentId: context.agentId,
        groupId: context.groupId,
        status: 'running',
        topicId: result.topicId,
      });
    }

    // Create a dedicated operation for gateway execution with correct context.
    // Stash the server operation id in metadata so human-intervention flows
    // (approve/reject/reject_continue) can look it up and call the server
    // without needing an out-of-band lookup.
    const { operationId: gatewayOpId } = this.#get().startOperation({
      context: execContext,
      metadata: { serverOperationId: result.operationId },
      parentOperationId,
      type: 'execServerAgentRuntime',
    });

    // Associate the server-created assistant message with the gateway operation
    this.#get().associateMessageWithOperation(result.assistantMessageId, gatewayOpId);

    // Also associate temp message IDs so the UI doesn't show a blank loading
    // state while waiting for the first `step_start` event to call
    // `replaceMessages` with the server's real message IDs.
    if (tempMessageIds?.length) {
      for (const tempId of tempMessageIds) {
        this.#get().associateMessageWithOperation(tempId, gatewayOpId);
      }
    }

    // Phase-1 init done: child op is running. Hand off loading state from
    // the caller's op (e.g. `sendMessage`) to the child without a gap.
    if (parentOperationId) this.#get().completeOperation(parentOperationId);

    // Optimistically update the local store's runningOperation for this topic so
    // useGatewayReconnect doesn't fire for a stale previous operation while the new
    // gateway connection is being established. Also disconnect any live reconnect
    // connection that was already established for the old operation.
    if (result.topicId) {
      const existingTopic = topicSelectors.getTopicById(result.topicId)(this.#get());
      const staleOpId = existingTopic?.metadata?.runningOperation?.operationId;
      if (staleOpId && staleOpId !== result.operationId) {
        this.#get().internal_dispatchTopic({
          id: result.topicId,
          type: 'updateTopic',
          value: {
            metadata: {
              ...existingTopic?.metadata,
              runningOperation: {
                assistantMessageId: result.assistantMessageId,
                operationId: result.operationId,
              },
            },
          },
        });
        this.disconnectFromGateway(staleOpId);
      }
    }

    // When the local operation is cancelled (e.g. user clicks stop), forward
    // the interrupt directly to the server via the existing tRPC endpoint.
    // Closure captures `result.operationId` (the server-side id) so we don't
    // depend on any metadata lookup. Fire-and-forget — errors are logged but
    // never block the local cancel flow.
    this.#get().onOperationCancel(gatewayOpId, async () => {
      await aiAgentService
        .interruptTask({ operationId: result.operationId, topicId: result.topicId })
        .catch((err) => console.error('[Gateway] interruptTask failed:', err));
    });

    const eventHandler = createGatewayEventHandler(this.#get, {
      assistantMessageId: result.assistantMessageId,
      context: execContext,
      // Server-side operation id — needed for tool_result dispatch back over
      // the same WS that gatewayConnections is keyed on.
      gatewayOperationId: result.operationId,
      operationId: gatewayOpId,
      // Shared run lifecycle: drives the terminal completeRun / afterRunComplete
      // for the gateway transport (op completion + unread + queue drain +
      // notification) at `agent_runtime_end` / `error`.
      runLifecycle: buildRunLifecycle(this.#get, {
        context: execContext,
        parentMessageId: result.assistantMessageId,
        parentMessageType: 'assistant',
        runId: gatewayOpId,
        runScope: (execContext.scope === 'sub_agent' ? 'sub_agent' : 'top_level') as RunScope,
        runtimeType: 'gateway',
      }),
    });

    // Demux the supervisor's WebSocket: with single-connection multiplexing
    // this WS also carries each broadcast member's streaming events (forwarded
    // server-side onto the supervisor op channel). Route owner events to the
    // full handler and member events to render-only member handlers so a
    // member's chunks stream into its own council column instead of corrupting
    // the supervisor bubble.
    const eventRouter = createGatewayEventRouter({
      createMemberHandler: this.buildMemberHandlerFactory(execContext, gatewayOpId),
      ownerHandler: eventHandler,
      ownerOperationId: result.operationId,
    });

    this.#get().connectToGateway({
      gatewayUrl: agentGatewayUrl,
      onEvent: eventRouter,
      onSessionComplete: ({ succeeded, terminalReceived }) => {
        // The gateway event handler already completed the op via the shared run
        // lifecycle on `agent_runtime_end` / `error`. Only complete here as the
        // terminal-missing fallback so the op never sticks `running`.
        if (!terminalReceived) this.#get().completeOperation(gatewayOpId);
        if (result.topicId) {
          // A clean completion the user isn't watching is owned by
          // `markTopicUnread` (status: 'unread'); skip the 'active' write so
          // the two never race over the status field. Every other case (viewing,
          // error, abort) clears the running state back to 'active' as before.
          const viewing = this.#get().activeTopicId === result.topicId;
          if (viewing || !succeeded) {
            void this.#get().updateTopicStatus?.({
              agentId: execContext.agentId,
              groupId: execContext.groupId,
              status: 'active',
              topicId: result.topicId,
            });
          }
          // Clear running operation from topic metadata (best-effort from frontend;
          // if browser was closed, reconnect logic will handle stale entries)
          topicService
            .updateTopicMetadata(result.topicId, { runningOperation: null })
            .catch(() => {});
          // Also clear the local store copy — the server clear above does NOT touch
          // the Zustand topic map that useGatewayReconnect reads (LOBE-12055).
          this.clearLocalRunningOperation({
            agentId: execContext.agentId,
            groupId: execContext.groupId,
            operationId: result.operationId,
            topicId: result.topicId,
          });
        }
        onComplete?.();
      },
      operationId: result.operationId,
      token: result.token || '',
      topicId: result.topicId,
    });

    return result;
  };

  /**
   * Reconnect to an existing Gateway operation after page reload.
   * Reads runningOperation from topic metadata, refreshes the JWT token,
   * and establishes a new WebSocket connection with event replay.
   */
  reconnectToGatewayOperation = async (params: {
    assistantMessageId: string;
    operationId: string;
    scope?: string;
    threadId?: string | null;
    topicId: string;
  }): Promise<void> => {
    const { assistantMessageId, operationId, topicId, scope, threadId } = params;

    const agentGatewayUrl =
      window.global_serverConfigStore?.getState()?.serverConfig?.agentGatewayUrl;
    if (!agentGatewayUrl) return;

    // Skip reconnect if the gateway action already established (or is establishing)
    // a fresh connection for this operation. This prevents a race on new-topic creation
    // where switchTopic loads runningOperation → useGatewayReconnect fires → overwrites
    // the connectToGateway call made by executeGatewayAgent with resumeOnConnect: true,
    // causing the gateway to treat a brand-new session as a resume → stuck / no events.
    // Any status other than 'disconnected' means the gateway action already owns this
    // connection (connecting / authenticating / reconnecting / connected). Skip to avoid
    // overwriting the fresh non-resume connect with resumeOnConnect:true.
    const existingStatus = this.#get().gatewayConnections[operationId]?.status;
    if (existingStatus && existingStatus !== 'disconnected') return;

    // Skip reconnect if the topic already has a newer running operation. This
    // happens when executeGatewayAgent was called (creating a new op) while this
    // stale reconnect was still queued — connecting to the old op would produce
    // duplicate streaming events alongside the new connection.
    const topicCurrentOpId = topicSelectors.getTopicById(topicId)(this.#get())?.metadata
      ?.runningOperation?.operationId;
    if (topicCurrentOpId && topicCurrentOpId !== operationId) return;

    // Get a fresh JWT token (original expired after 5 min). The server throws
    // TRPCError NOT_FOUND when it has no running operation on this topic — our
    // local marker is stale (e.g. an error run cleared the server marker but not
    // the store). Clear it and bail silently so the reconnect SWR fetcher resolves
    // and does not retry the 404 forever (LOBE-12055).
    let token: string;
    try {
      ({ token } = await aiAgentService.refreshGatewayToken(topicId));
    } catch (error) {
      if (isTrpcErrorCode(error, 'NOT_FOUND')) {
        this.clearLocalRunningOperation({ operationId, topicId });
        return;
      }
      throw error;
    }

    // Re-check after the async token refresh: a newer executeGatewayAgent call may have
    // taken over for this topic while we were waiting. If so, bail to avoid a duplicate stream.
    // (disconnectFromGateway on the stale op is a no-op here because we haven't connected yet.)
    const topicOpIdAfterRefresh = topicSelectors.getTopicById(topicId)(this.#get())?.metadata
      ?.runningOperation?.operationId;
    if (topicOpIdAfterRefresh && topicOpIdAfterRefresh !== operationId) return;

    const agentId = this.#get().activeAgentId;
    const context = {
      agentId,
      scope: (scope ?? 'main') as ConversationContext['scope'],
      threadId: threadId ?? null,
      topicId,
    };

    // Anchor the operation to the run's real start: the assistant message was
    // created when the run began. Defaulting to Date.now() here would reset
    // elapsed-time displays (OpStatusTray) to zero on every page refresh.
    const assistantMessage = Object.values(this.#get().messagesMap)
      .flat()
      .find((m) => m.id === assistantMessageId);

    // `createdAt` is typed as a number but, after a DB rehydrate, it can arrive
    // as a Date / ISO string (the message service casts rows `as unknown` without
    // converting). Normalize to epoch ms here so the elapsed-time math stays a
    // number — passing a string/Invalid Date straight through makes
    // `Date.now() - startTime` resolve to NaN and renders as "NaN:NaN".
    const startTime = assistantMessage?.createdAt
      ? new Date(assistantMessage.createdAt).getTime()
      : undefined;

    // Create a local operation for UI loading state, stashing the server op id
    // so intervention flows can find it after reconnect as well.
    const { operationId: gatewayOpId } = this.#get().startOperation({
      context,
      metadata: {
        serverOperationId: operationId,
        ...(Number.isFinite(startTime) ? { startTime } : {}),
      },
      type: 'execServerAgentRuntime',
    });

    this.#get().associateMessageWithOperation(assistantMessageId, gatewayOpId);

    // Forward local-op cancellation to the server-side agent loop via tRPC.
    // See note in executeGatewayAgent for details.
    this.#get().onOperationCancel(gatewayOpId, async () => {
      await aiAgentService
        .interruptTask({ operationId })
        .catch((err) => console.error('[Gateway] interruptTask failed:', err));
    });

    const eventHandler = createGatewayEventHandler(this.#get, {
      assistantMessageId,
      context,
      // Server-side operation id — needed for tool_result dispatch back over
      // the same WS that gatewayConnections is keyed on.
      gatewayOperationId: operationId,
      operationId: gatewayOpId,
      runLifecycle: buildRunLifecycle(this.#get, {
        context,
        parentMessageId: assistantMessageId,
        parentMessageType: 'assistant',
        runId: gatewayOpId,
        runScope: (context.scope === 'sub_agent' ? 'sub_agent' : 'top_level') as RunScope,
        runtimeType: 'gateway',
      }),
    });

    // Same demux as the initial-run path: a reconnected supervisor WS can also
    // receive forwarded member events, so route them away from the supervisor
    // handler (and stream them when the reconnect context carries the group).
    const eventRouter = createGatewayEventRouter({
      createMemberHandler: this.buildMemberHandlerFactory(context, gatewayOpId),
      ownerHandler: eventHandler,
      ownerOperationId: operationId,
    });

    this.#get().connectToGateway({
      gatewayUrl: agentGatewayUrl,
      onEvent: eventRouter,
      onSessionComplete: ({ succeeded, terminalReceived, authFailed }) => {
        // A reconnect is a passive re-subscribe — it must not END a run it merely
        // re-subscribed to. Only finalize when the close PROVES the op is over:
        //   - terminalReceived: a real agent_runtime_end / error streamed in, or
        //   - authFailed: the gateway rejected the op's token (GC'd / gone).
        // A bare `resume_complete` terminal *status* with neither is ambiguous —
        // it also fires for a still-running op the gateway DO has no live session
        // for (typically a heterogeneous CC run streaming via heteroIngest).
        // Clearing runningOperation there would black-hole every subsequent
        // heteroIngest batch (StaleHeteroOperationError) and silently kill the
        // live agent, so leave the marker to the real terminal sites (heteroFinish
        // / the inactivity watchdog) and just drop our local connection op.
        if (!terminalReceived && !authFailed) {
          this.#get().completeOperation(gatewayOpId);
          return;
        }

        // The run lifecycle already completed the op when a terminal event
        // arrived; an auth failure carries no such event, so finalize it here so
        // the local op never sticks `running`.
        if (authFailed) this.#get().completeOperation(gatewayOpId);

        // See executeGatewayAgent's onSessionComplete: a clean background
        // completion is left to markTopicUnread (status: 'unread').
        const viewing = this.#get().activeTopicId === topicId;
        if (viewing || !succeeded) {
          void this.#get().updateTopicStatus?.({
            agentId: context.agentId,
            status: 'active',
            topicId,
          });
        }
        // Clear the persisted marker useGatewayReconnect keys off so a dead op
        // doesn't get reconnected on every reload / task-drawer open.
        topicService.updateTopicMetadata(topicId, { runningOperation: null }).catch(() => {});
        // Mirror the clear into the local store — the server clear above leaves the
        // Zustand topic map stale, which useGatewayReconnect keys off (LOBE-12055).
        this.clearLocalRunningOperation({ agentId: context.agentId, operationId, topicId });
      },
      operationId,
      resumeOnConnect: true,
      token,
      topicId,
    });
  };

  /**
   * Build the `createMemberHandler` factory for a run's event router, with a
   * single memoized group-tree hydration shared across all of that run's member
   * handlers. The first member to stream triggers one `getMessages` +
   * `replaceMessages` so the canonical council structure (the `agentCouncil` tool
   * message + every member row) lands — which is what makes the members render as
   * parallel columns rather than a stack — and concurrent members reuse the same
   * promise instead of each re-replacing the bucket and clobbering live content.
   */
  private buildMemberHandlerFactory = (
    context: ConversationContext,
    parentOperationId: string,
  ): ((memberOperationId: string) => (event: AgentStreamEvent) => void) => {
    let hydration: Promise<void> | undefined;
    const ensureGroupHydrated = () => {
      if (!hydration) {
        hydration = messageService
          .getMessages(context)
          .then((messages) => {
            this.#get().replaceMessages(messages, { context });
          })
          .catch(() => {});
      }
      return hydration;
    };

    return (memberOperationId: string) =>
      createGatewayMemberStreamHandler(this.#get, {
        context,
        ensureGroupHydrated,
        memberOperationId,
        parentOperationId,
      });
  };

  /**
   * Clear the client-store copy of `topic.metadata.runningOperation`.
   *
   * The server-side clear (`topicService.updateTopicMetadata(topicId, { runningOperation: null })`)
   * alone leaves the Zustand store stale: `useGatewayReconnect` keys off the LOCAL
   * copy, so after an error run (e.g. insufficient credits) the stale marker keeps
   * firing `aiAgentService.refreshGatewayToken(topicId)`, which the server now answers
   * with NOT_FOUND (404 — the server-side marker is already null). Raw SWR retries the
   * 404 forever and wedges the conversation (LOBE-12055).
   *
   * The `updateTopic` reducer shallow-merges `value.metadata` (`{...currentTopic, ...value}`),
   * so we spread the existing metadata to avoid dropping its other keys. Only dispatch when
   * the topic still carries the marker for `operationId` — a late close of a finished op
   * can race with a retry/send that already wrote a NEWER operation's marker, and clearing
   * unconditionally would break reconnect-after-reload for that live run.
   *
   * `agentId`/`groupId` route the lookup + dispatch to the run's OWNING topic bucket
   * (same convention as `updateTopicStatus`): a background completion can land after the
   * user switched agent/group, when the active-bucket `getTopicById` would miss the topic
   * and leave its marker stale.
   */
  private clearLocalRunningOperation = (params: {
    agentId?: string;
    groupId?: string;
    operationId: string;
    topicId: string;
  }): void => {
    const { topicId, operationId, agentId, groupId } = params;
    const state = this.#get();
    const key = topicMapKey({
      agentId: agentId ?? state.activeAgentId,
      groupId: groupId ?? state.activeGroupId,
    });
    const existingTopic = state.topicDataMap[key]?.items?.find((t) => t.id === topicId);
    if (existingTopic?.metadata?.runningOperation?.operationId !== operationId) return;

    state.internal_dispatchTopic({
      agentId,
      groupId,
      id: topicId,
      type: 'updateTopic',
      value: { metadata: { ...existingTopic.metadata, runningOperation: null } },
    });
  };

  private internal_cleanupGatewayConnection = (operationId: string): void => {
    this.#set(
      (state) => {
        const { [operationId]: _, ...rest } = state.gatewayConnections;
        return { gatewayConnections: rest };
      },
      false,
      'gateway/cleanup',
    );
  };
}

export type GatewayAction = Pick<GatewayActionImpl, keyof GatewayActionImpl>;
