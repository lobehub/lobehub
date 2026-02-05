import { fetchEventSource } from '@lobechat/utils/client';
import debug from 'debug';

import type {StreamConnectionOptions, StreamEvent} from './type';

const log = debug('lobe-agent-runtime:client');

/**
 * Agent Client Service for communicating with durable agents
 */
class AgentRuntimeClient {
  private baseUrl = '/api/agent';

  /**
   * Create a streaming connection to receive real-time agent events
   */
  createStreamConnection(
    operationId: string,
    options: StreamConnectionOptions = {},
  ): AbortController {
    const {
      includeHistory = false,
      lastEventId = '0',
      onEvent,
      onError,
      onConnect,
      onDisconnect,
    } = options;

    const params = new URLSearchParams({
      includeHistory: includeHistory.toString(),
      lastEventId,
      operationId,
    });

    const controller = new AbortController();

    fetchEventSource(`${this.baseUrl}/stream?${params}`, {
      headers: {
        'Cache-Control': 'no-cache',
        'Last-Event-ID': lastEventId,
      },
      onclose: () => {
        log(`Stream connection closed for operation ${operationId}`);
        onDisconnect?.();
      },
      onerror: (error) => {
        console.error(`[AgentClientService] Stream error for operation ${operationId}:`, error);
        onError?.(error instanceof Error ? error : new Error('Stream connection error'));
      },
      onmessage: (event) => {
        try {
          const data = JSON.parse(event.data) as StreamEvent;
          log(`Received event: ${event.event || 'message'}`, event.data);

          onEvent?.(data);
        } catch (error) {
          console.error('[AgentClientService] Failed to parse stream event:', error);
          onError?.(new Error('Failed to parse stream event'));
        }
      },
      onopen: async (response) => {
        if (response.ok) {
          log(`Stream connection opened for operation ${operationId}`);
          onConnect?.();
        } else {
          throw new Error(`Failed to open stream: ${response.status} ${response.statusText}`);
        }
      },
      signal: controller.signal,
    });

    return controller;
  }
}

export const agentRuntimeClient = new AgentRuntimeClient();
