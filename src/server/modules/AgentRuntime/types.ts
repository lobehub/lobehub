import { type AgentState } from '@lobechat/agent-runtime';

import { type AgentOperationMetadata, type StepResult } from './AgentStateManager';
import { type StreamChunkData, type StreamEvent } from './StreamEventManager';

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
      modelRuntimeConfig?: any;
      userId?: string;
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
   * Save Agent state
   */
  saveAgentState: (operationId: string, state: AgentState) => Promise<void>;

  /**
   * Save step execution result
   */
  saveStepResult: (operationId: string, stepResult: StepResult) => Promise<void>;
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
   * Publish Agent runtime end event
   */
  publishAgentRuntimeEnd: (
    operationId: string,
    stepIndex: number,
    finalState: any,
    reason?: string,
    reasonDetail?: string,
  ) => Promise<string>;

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
}
