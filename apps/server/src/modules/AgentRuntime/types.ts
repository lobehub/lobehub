import type { ToolExecuteData } from '@lobechat/agent-gateway-client';
import { type AgentState } from '@lobechat/agent-runtime';
import { type UIChatMessage } from '@lobechat/types';

import { type AgentOperationMetadata, type StepResult } from './AgentStateManager';
import { type StreamChunkData, type StreamEvent } from './StreamEventManager';

export interface PublishAgentRuntimeEndParams {
  finalState: any;
  operationId: string;
  reason?: string;
  reasonDetail?: string;
  stepIndex: number;
  /**
   * Canonical UIChatMessage[] snapshot of the topic at terminal-state time.
   * When present, the client uses this directly as Source of Truth instead
   * of refetching from DB.
   */
  uiMessages?: UIChatMessage[];
}

/**
 * Agent State Manager Interface
 * Abstract interface for state persistence, supports Redis and in-memory implementations
 */
export interface IAgentStateManager {
  /**
   * Clean up expired operation data
   */
  cleanupExpiredOperations: () => Promise<number>;

  /**
   * Create new operation metadata
   */
  createOperationMetadata: (
    operationId: string,
    data: {
      agentConfig?: any;
      mirrorToOperationId?: string;
      modelRuntimeConfig?: any;
      userId?: string;
      workspaceId?: string;
    },
  ) => Promise<void>;

  /**
   * Delete all data for Agent operation
   */
  deleteAgentOperation: (operationId: string) => Promise<void>;

  /**
   * Close connections
   */
  disconnect: () => Promise<void>;

  /**
   * Get all active operations
   */
  getActiveOperations: () => Promise<string[]>;

  /**
   * Get execution history
   */
  getExecutionHistory: (operationId: string, limit?: number) => Promise<any[]>;

  /**
   * Get operation metadata
   */
  getOperationMetadata: (operationId: string) => Promise<AgentOperationMetadata | null>;

  /**
   * Get statistics
   */
  getStats: () => Promise<{
    activeOperations: number;
    completedOperations: number;
    errorOperations: number;
    totalOperations: number;
  }>;

  /**
   * Load Agent state
   */
  loadAgentState: (operationId: string) => Promise<AgentState | null>;

  /**
   * Extend the step execution lock if it is still owned by the caller.
   */
  refreshStepLock: (
    operationId: string,
    stepIndex: number,
    ttlSeconds: number,
    ownerId?: string,
  ) => Promise<boolean>;

  /**
   * Release the step execution lock.
   */
  releaseStepLock: (operationId: string, stepIndex: number, ownerId?: string) => Promise<void>;

  /**
   * Save Agent state
   */
  saveAgentState: (operationId: string, state: AgentState) => Promise<void>;

  /**
   * Save step execution result
   */
  saveStepResult: (operationId: string, stepResult: StepResult) => Promise<void>;

  /**
   * Atomically try to claim a step for execution (distributed lock).
   * Returns true if the lock was acquired, false if another execution already holds it.
   */
  tryClaimStep: (
    operationId: string,
    stepIndex: number,
    ttlSeconds?: number,
    ownerId?: string,
  ) => Promise<boolean>;
}

/**
 * Stream Event Manager Interface
 * Abstract interface for stream event publishing, supports Redis and in-memory implementations
 */
export interface IStreamEventManager {
  /**
   * Clean up stream data for operation
   */
  cleanupOperation: (operationId: string) => Promise<void>;

  /**
   * Close connections
   */
  disconnect: () => Promise<void>;

  /**
   * Get count of active operations
   */
  getActiveOperationsCount: () => Promise<number>;

  /**
   * Get stream event history
   */
  getStreamHistory: (operationId: string, count?: number) => Promise<StreamEvent[]>;

  /**
   * Publish Agent runtime end event.
   *
   * `uiMessages` is the canonical UIChatMessage[] snapshot of the topic at
   * terminal-state time so the client can use the pushed payload as Source
   * of Truth instead of refetching from DB. Optional: callers without DB
   * access may omit it and the client falls back to its existing behaviour.
   */
  publishAgentRuntimeEnd: (params: PublishAgentRuntimeEndParams) => Promise<string>;

  /**
   * Publish Agent runtime initialization event
   */
  publishAgentRuntimeInit: (operationId: string, initialState: any) => Promise<string>;

  /**
   * Publish stream content chunk
   */
  publishStreamChunk: (
    operationId: string,
    stepIndex: number,
    chunkData: StreamChunkData,
  ) => Promise<string>;

  /**
   * Publish stream event
   */
  publishStreamEvent: (
    operationId: string,
    event: Omit<StreamEvent, 'operationId' | 'timestamp'>,
  ) => Promise<string>;

  /**
   * Single bounded read of a stream — the long-poll primitive. Returns every
   * event after `lastEventId`, blocking up to `blockMs` for the first one; on
   * timeout returns an empty list. The returned `lastEventId` is always a
   * CONCRETE stream id (never the `'$'` sentinel), so the caller can immediately
   * re-poll from it without a gap. Unlike `subscribeStreamEvents` this does NOT
   * loop — one request, one bounded wait.
   *
   * Used by the heterogeneous `lh hetero exec` producer (which holds only an
   * op-scoped JWT + tRPC, never Redis) to pull `agent_intervention_response`
   * back into its in-process `AskUserBridge`. See `aiAgent.waitInterventionResponse`.
   */
  readEventsOnce: (
    operationId: string,
    lastEventId?: string,
    blockMs?: number,
  ) => Promise<{ events: StreamEvent[]; lastEventId: string }>;

  /**
   * Optional: dispatch a tool execution request to the client via Agent Gateway.
   * Rejects if the gateway is unavailable — callers decide their fallback path.
   * Only present on implementations that speak to a live gateway (not on the
   * in-memory / Redis-only managers).
   */
  sendToolExecute?: (operationId: string, data: ToolExecuteData) => Promise<void>;

  /**
   * Subscribe to stream events (for SSE endpoint)
   */
  subscribeStreamEvents: (
    operationId: string,
    lastEventId: string,
    onEvents: (events: StreamEvent[]) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
}
