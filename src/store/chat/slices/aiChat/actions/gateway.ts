import type { ConversationContext, ExecAgentResult } from '@lobechat/types';

import type {
  AgentStreamClientOptions,
  AgentStreamEvent,
  ConnectionStatus,
} from '@/libs/agent-stream';
import { AgentStreamClient } from '@/libs/agent-stream/client';
import { aiAgentService } from '@/services/aiAgent';
import { messageService } from '@/services/message';
import { topicService } from '@/services/topic';
import type { ChatStore } from '@/store/chat/store';
import type { StoreSetter } from '@/store/types';
import { useUserStore } from '@/store/user';

import { createGatewayEventHandler } from './gatewayEventHandler';

type Setter = StoreSetter<ChatStore>;

// ─── Types ───

export interface GatewayConnection {
  client: Pick<AgentStreamClient, 'connect' | 'disconnect' | 'on' | 'sendInterrupt'>;
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
    const { operationId, gatewayUrl, token, onEvent, onSessionComplete, resumeOnConnect } = params;

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

    // Forward agent events to caller
    if (onEvent) {
      client.on('agent_event', onEvent);
    }

    // Handle session completion
    client.on('session_complete', () => {
      this.internal_cleanupGatewayConnection(operationId);
      onSessionComplete?.();
    });

    // Handle disconnection (terminal events auto-disconnect the client)
    client.on('disconnected', () => {
      this.internal_cleanupGatewayConnection(operationId);
    });

    // Handle auth failures
    client.on('auth_failed', (reason) => {
      console.error(`[Gateway] Auth failed for operation ${operationId}: ${reason}`);
      this.internal_cleanupGatewayConnection(operationId);
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
    message: string;
    /** Called when the gateway session completes (agent finished running) */
    onComplete?: () => void;
    /** Parent message ID for regeneration/continue (skip user message creation, branch from this message) */
    parentMessageId?: string;
  }): Promise<ExecAgentResult> => {
    const { context, message, onComplete, parentMessageId } = params;

    const agentGatewayUrl =
      window.global_serverConfigStore!.getState().serverConfig.agentGatewayUrl!;

    const isCreateNewTopic = !context.topicId;

    const result = await aiAgentService.execAgentTask({
      agentId: context.agentId,
      appContext: {
        groupId: context.groupId,
        scope: context.scope,
        threadId: context.threadId,
        topicId: context.topicId,
      },
      parentMessageId,
      prompt: message,
    });

    // If server created a new topic, fetch messages first then switch topic
    // (same pattern as client mode: replaceMessages before switchTopic to avoid skeleton flash)
    if (isCreateNewTopic && result.topicId) {
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
    }

    // Use the server-created topicId for the execution context
    const execContext = { ...context, topicId: result.topicId };

    if (result.topicId) {
      this.#get().internal_updateTopicLoading(result.topicId, true);
    }

    // Create a dedicated operation for gateway execution with correct context
    const { operationId: gatewayOpId } = this.#get().startOperation({
      context: execContext,
      type: 'execServerAgentRuntime',
    });

    // Associate the server-created assistant message with the gateway operation
    this.#get().associateMessageWithOperation(result.assistantMessageId, gatewayOpId);

    const eventHandler = createGatewayEventHandler(this.#get, {
      assistantMessageId: result.assistantMessageId,
      context: execContext,
      operationId: gatewayOpId,
    });

    this.#get().connectToGateway({
      gatewayUrl: agentGatewayUrl,
      onEvent: eventHandler,
      onSessionComplete: () => {
        this.#get().completeOperation(gatewayOpId);
        if (result.topicId) {
          this.#get().internal_updateTopicLoading(result.topicId, false);
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

    if (!this.isGatewayModeEnabled()) return;

    const agentGatewayUrl =
      window.global_serverConfigStore!.getState().serverConfig.agentGatewayUrl!;

    // Get a fresh JWT token (original expired after 5 min)
    const { token } = await aiAgentService.refreshGatewayToken(topicId);

    const agentId = this.#get().activeAgentId;
    const context = {
      agentId,
      scope: (scope ?? 'main') as ConversationContext['scope'],
      threadId: threadId ?? null,
      topicId,
    };

    // Create a local operation for UI loading state
    const { operationId: gatewayOpId } = this.#get().startOperation({
      context,
      type: 'execServerAgentRuntime',
    });

    this.#get().associateMessageWithOperation(assistantMessageId, gatewayOpId);

    const eventHandler = createGatewayEventHandler(this.#get, {
      assistantMessageId,
      context,
      operationId: gatewayOpId,
    });

    this.#get().connectToGateway({
      gatewayUrl: agentGatewayUrl,
      onEvent: eventHandler,
      onSessionComplete: () => {
        this.#get().completeOperation(gatewayOpId);
        this.#get().internal_updateTopicLoading(topicId, false);
        topicService.updateTopicMetadata(topicId, { runningOperation: null }).catch(() => {});
      },
      operationId,
      resumeOnConnect: true,
      token,
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
