import {
  AgentStreamClient,
  type AgentStreamClientOptions,
  type AgentStreamEvent,
  type ConnectionStatus,
} from '@lobechat/agent-gateway-client';
import type { ConversationContext, ExecAgentResult, MessageMetadata } from '@lobechat/types';

import { isDesktop } from '@/const/version';
import { aiAgentService, type ResumeApprovalParam } from '@/services/aiAgent';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import { getAgentStoreState } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';
import { consumePendingTopicRepos, getPendingTopicRepos } from '@/store/chat/pendingTopicRepos';
import { topicSelectors } from '@/store/chat/selectors';
import type { ChatStore } from '@/store/chat/store';
import type { StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';

import { createGatewayEventHandler } from './gatewayEventHandler';

/**
 * When the agent runs against the local machine ("本机"), resolve this desktop's
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

  const isLocal = chatConfigByIdSelectors.isLocalSystemEnabledById(agentId)(getAgentStoreState());
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
   * Called when the session completes (agent_runtime_end or session_complete)
   */
  onSessionComplete?: () => void;
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
    let sessionCompleted = false;
    const fireSessionComplete = () => {
      if (sessionCompleted) return;
      sessionCompleted = true;
      onSessionComplete?.();
    };

    // Forward agent events to caller, and track terminal events
    client.on('agent_event', (event) => {
      if (event.type === 'agent_runtime_end' || event.type === 'error') {
        receivedTerminalEvent = true;
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
      fireSessionComplete();
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
        fireSessionComplete();
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
   * Returns true if both server config and user lab toggle are set.
   */
  isGatewayModeEnabled = (): boolean => {
    const agentGatewayUrl =
      window.global_serverConfigStore?.getState()?.serverConfig?.agentGatewayUrl;
    const enableGatewayMode = useUserStore.getState().preference.lab?.enableGatewayMode;

    return !!agentGatewayUrl && !!enableGatewayMode;
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
      parentMessageId,
      parentOperationId,
      resumeApproval,
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
    const initialTopicMetadata =
      pendingRepos.length > 0
        ? { repos: pendingRepos, workingDirectory: pendingRepos[0] }
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

    const result = await aiAgentService.execAgentTask(
      {
        agentId: context.agentId,
        appContext: {
          agentDocumentId: context.agentDocumentId,
          defaultTaskAssigneeAgentId: context.defaultTaskAssigneeAgentId,
          documentId: context.documentId,
          groupId: context.groupId,
          ...(initialTopicMetadata && { initialTopicMetadata }),
          scope: context.scope,
          taskId,
          threadId: context.threadId,
          topicId: context.topicId,
        },
        deviceId: localDeviceId,
        fileIds,
        parentMessageId,
        prompt: message,
        resumeApproval,
        trigger: metadata?.trigger,
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

    if (result.topicId) {
      this.#get().internal_updateTopicLoading(result.topicId, true);
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
    });

    this.#get().connectToGateway({
      gatewayUrl: agentGatewayUrl,
      onEvent: eventHandler,
      onSessionComplete: () => {
        this.#get().completeOperation(gatewayOpId);
        if (result.topicId) {
          this.#get().internal_updateTopicLoading(result.topicId, false);
          void this.#get().updateTopicStatus?.({
            agentId: execContext.agentId,
            groupId: execContext.groupId,
            status: 'active',
            topicId: result.topicId,
          });
          // Clear running operation from topic metadata (best-effort from frontend;
          // if browser was closed, reconnect logic will handle stale entries)
          topicService
            .updateTopicMetadata(result.topicId, { runningOperation: null })
            .catch(() => {});
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

    // Get a fresh JWT token (original expired after 5 min)
    const { token } = await aiAgentService.refreshGatewayToken(topicId);

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

    // Create a local operation for UI loading state, stashing the server op id
    // so intervention flows can find it after reconnect as well.
    const { operationId: gatewayOpId } = this.#get().startOperation({
      context,
      metadata: {
        serverOperationId: operationId,
        ...(assistantMessage?.createdAt ? { startTime: assistantMessage.createdAt } : {}),
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
    });

    this.#get().connectToGateway({
      gatewayUrl: agentGatewayUrl,
      onEvent: eventHandler,
      onSessionComplete: () => {
        this.#get().completeOperation(gatewayOpId);
        this.#get().internal_updateTopicLoading(topicId, false);
        void this.#get().updateTopicStatus?.({
          agentId: context.agentId,
          status: 'active',
          topicId,
        });
        topicService.updateTopicMetadata(topicId, { runningOperation: null }).catch(() => {});
      },
      operationId,
      resumeOnConnect: true,
      token,
      topicId,
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
