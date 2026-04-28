import type { ToolExecuteData } from '@lobechat/agent-gateway-client';
import debug from 'debug';
import urlJoin from 'url-join';

import {
  getDefaultReasonDetail,
  type StreamChunkData,
  type StreamEvent,
} from './StreamEventManager';
import type { IStreamEventManager } from './types';

const log = debug('lobe-server:agent-runtime:gateway-notifier');

const POST_TIMEOUT = 5000; // 5s per request
const MAX_INFLIGHT = 20; // bounded concurrency

/**
 * Decorator that wraps an IStreamEventManager and additionally
 * pushes events to the Agent Gateway via HTTP (fire-and-forget).
 *
 * Redis SSE remains the primary event storage / subscription mechanism.
 * The Gateway is an additional push channel for WebSocket delivery.
 */
export class GatewayStreamNotifier implements IStreamEventManager {
  private inflight = 0;

  constructor(
    private inner: IStreamEventManager,
    private gatewayUrl: string,
    private serviceToken: string,
  ) {
    log('Gateway notifier initialized: %s', gatewayUrl);
  }

  // ─── Publish methods: delegate to inner + notify gateway ───

  async publishStreamEvent(
    operationId: string,
    event: Omit<StreamEvent, 'operationId' | 'timestamp'>,
  ): Promise<string> {
    const result = await this.inner.publishStreamEvent(operationId, event);
    this.pushEvent(operationId, { ...event, operationId, timestamp: Date.now() });
    return result;
  }

  async publishStreamChunk(
    operationId: string,
    stepIndex: number,
    chunkData: StreamChunkData,
  ): Promise<string> {
    const result = await this.inner.publishStreamChunk(operationId, stepIndex, chunkData);
    this.pushEvent(operationId, {
      data: chunkData,
      operationId,
      stepIndex,
      timestamp: Date.now(),
      type: 'stream_chunk',
    });
    return result;
  }

  async publishAgentRuntimeInit(operationId: string, initialState: any): Promise<string> {
    const result = await this.inner.publishAgentRuntimeInit(operationId, initialState);

    this.httpPost('/api/operations/init', {
      operationId,
      userId: initialState?.userId || 'unknown',
    });

    this.pushEvent(operationId, {
      data: initialState,
      operationId,
      stepIndex: 0,
      timestamp: Date.now(),
      type: 'agent_runtime_init',
    });

    return result;
  }

  async publishAgentRuntimeEnd(
    operationId: string,
    stepIndex: number,
    finalState: any,
    reason?: string,
    reasonDetail?: string,
  ): Promise<string> {
    const result = await this.inner.publishAgentRuntimeEnd(
      operationId,
      stepIndex,
      finalState,
      reason,
      reasonDetail,
    );

    const effectiveReasonDetail = reasonDetail || getDefaultReasonDetail(finalState, reason);
    const errorType = finalState?.error?.type || finalState?.error?.errorType;

    this.pushEvent(operationId, {
      data: { errorType, finalState, reason, reasonDetail: effectiveReasonDetail },
      operationId,
      stepIndex,
      timestamp: Date.now(),
      type: 'agent_runtime_end',
    });

    return result;
  }

  /**
   * Request the client to execute a tool via Agent Gateway → WebSocket.
   * Unlike the other push methods this is NOT fire-and-forget: callers rely
   * on the promise outcome to decide whether to block-await a result or
   * fall back to the interrupt-resume path. Rejects on HTTP error / timeout.
   */
  async sendToolExecute(operationId: string, data: ToolExecuteData): Promise<void> {
    log('sendToolExecute operation=%s toolCallId=%s', operationId, data.toolCallId);
    await this.httpPostAwait('/api/operations/tool-execute', { data, operationId });
  }

  // ─── Read / subscribe methods: delegate directly to inner ───

  async subscribeStreamEvents(
    operationId: string,
    lastEventId: string,
    onEvents: (events: StreamEvent[]) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.inner.subscribeStreamEvents(operationId, lastEventId, onEvents, signal);
  }

  async getStreamHistory(operationId: string, count?: number): Promise<StreamEvent[]> {
    return this.inner.getStreamHistory(operationId, count);
  }

  async cleanupOperation(operationId: string): Promise<void> {
    return this.inner.cleanupOperation(operationId);
  }

  async getActiveOperationsCount(): Promise<number> {
    return this.inner.getActiveOperationsCount();
  }

  async disconnect(): Promise<void> {
    return this.inner.disconnect();
  }

  // ─── Gateway HTTP helpers ───

  private pushEvent(operationId: string, event: Record<string, unknown>) {
    this.httpPost('/api/operations/push-event', { event, operationId }).catch(() => {});
  }

  /**
   * POST that surfaces errors back to the caller (no swallow). Used for
   * request-response style pushes like tool_execute where the caller needs
   * to know whether the gateway accepted the request.
   */
  private async httpPostAwait(path: string, body: Record<string, unknown>): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POST_TIMEOUT);

    try {
      const res = await fetch(urlJoin(this.gatewayUrl, path), {
        body: JSON.stringify(body),
        headers: {
          'Authorization': `Bearer ${this.serviceToken}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Gateway ${path} returned ${res.status}: ${text}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private async httpPost(path: string, body: Record<string, unknown>): Promise<void> {
    if (this.inflight >= MAX_INFLIGHT) {
      log('Gateway %s dropped: max inflight (%d) reached', path, MAX_INFLIGHT);
      return;
    }

    this.inflight++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POST_TIMEOUT);

    try {
      const res = await fetch(urlJoin(this.gatewayUrl, path), {
        body: JSON.stringify(body),
        headers: {
          'Authorization': `Bearer ${this.serviceToken}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      });

      if (!res.ok) {
        log('Gateway %s returned %d: %s', path, res.status, await res.text());
      }
    } catch (error) {
      log('Gateway %s failed: %O', path, error);
    } finally {
      clearTimeout(timer);
      this.inflight--;
    }
  }
}
