import type { ConversationContext } from '@lobechat/types';

import type {
  AgentStreamClientOptions,
  AgentStreamEvent,
  ConnectionStatus,
} from '@/libs/agent-stream';
import { AgentStreamClient } from '@/libs/agent-stream/client';
import { aiAgentService } from '@/services/aiAgent';
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
    const { operationId, gatewayUrl, token, onEvent, onSessionComplete } = params;

    // Disconnect existing connection for this operation if any
    this.disconnectFromGateway(operationId);

    const client = this.createClient({ gatewayUrl, operationId, token });

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
  executeGatewayAgent = async (params: {
    assistantMessageId: string;
    context: ConversationContext;
    message: string;
    parentOperationId: string;
    topicId?: string;
    userMessageId: string;
  }): Promise<void> => {
    const { assistantMessageId, context, message, parentOperationId, topicId, userMessageId } =
      params;

    const agentGatewayUrl =
      window.global_serverConfigStore!.getState().serverConfig.agentGatewayUrl!;

    const result = await aiAgentService.execAgentTask({
      agentId: context.agentId,
      appContext: {
        groupId: context.groupId,
        scope: context.scope,
        threadId: context.threadId,
        topicId: context.topicId,
      },
      existingMessageIds: [userMessageId, assistantMessageId],
      prompt: message,
    });

    // Create a dedicated operation for gateway execution with correct context
    const { operationId: gatewayOpId } = this.#get().startOperation({
      context,
      parentOperationId,
      type: 'execServerAgentRuntime',
    });

    // Associate the initial assistant message with the gateway operation
    // so the UI shows loading/generating state via the operation system
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
        if (topicId) this.#get().internal_updateTopicLoading(topicId, false);
      },
      operationId: result.operationId,
      token: result.token || '',
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
