import { type AgentState } from '@lobechat/agent-runtime';
import debug from 'debug';

import { type AgentOperationMetadata, type StepResult } from './AgentStateManager';
import { createAgentStateManager, createStreamEventManager } from './factory';
import { type IAgentStateManager, type IStreamEventManager } from './types';

const log = debug('lobe-server:agent-runtime:coordinator');

export interface AgentRuntimeCoordinatorOptions {
  /**
   * Custom state manager implementation
   * Defaults to automatic selection based on Redis availability
   */
  stateManager?: IAgentStateManager;
  /**
   * Custom stream event manager implementation
   * Defaults to automatic selection based on Redis availability
   */
  streamEventManager?: IStreamEventManager;
}

/**
 * Agent Runtime Coordinator
 * Coordinates operations between AgentStateManager and StreamEventManager
 * Responsible for sending corresponding events when state changes occur
 *
 * Default behavior:
 * - Uses Redis implementation when Redis is available
 * - Automatically falls back to in-memory implementation when Redis is unavailable (local development mode)
 *
 * Supports dependency injection, allowing custom implementations to be passed in
 */
export class AgentRuntimeCoordinator {
  private stateManager: IAgentStateManager;
  private streamEventManager: IStreamEventManager;

  constructor(options?: AgentRuntimeCoordinatorOptions) {
    this.stateManager = options?.stateManager ?? createAgentStateManager();
    this.streamEventManager = options?.streamEventManager ?? createStreamEventManager();
  }

  /**
   * Create a new Agent operation and send initialization event
   */
  async createAgentOperation(
    operationId: string,
    data: {
      agentConfig?: any;
      modelRuntimeConfig?: any;
      userId?: string;
    },
  ): Promise<void> {
    try {
      // Create operation metadata
      await this.stateManager.createOperationMetadata(operationId, data);

      // Get the created metadata
      const metadata = await this.stateManager.getOperationMetadata(operationId);

      if (metadata) {
        // Send agent runtime init event
        await this.streamEventManager.publishAgentRuntimeInit(operationId, metadata);
        log('[%s] Agent operation created and initialized', operationId);
      }
    } catch (error) {
      console.error('Failed to create agent operation:', error);
      throw error;
    }
  }

  /**
   * Save Agent state and handle corresponding events
   */
  async saveAgentState(operationId: string, state: AgentState): Promise<void> {
    try {
      const previousState = await this.stateManager.loadAgentState(operationId);

      // Save state
      await this.stateManager.saveAgentState(operationId, state);

      // If status changes to done, send agent runtime end event
      if (state.status === 'done' && previousState?.status !== 'done') {
        await this.streamEventManager.publishAgentRuntimeEnd(operationId, state.stepCount, state);
        log('[%s] Agent runtime completed', operationId);
      }
    } catch (error) {
      console.error('Failed to save agent state and handle events:', error);
      throw error;
    }
  }

  /**
   * Save step result and handle corresponding events
   */
  async saveStepResult(operationId: string, stepResult: StepResult): Promise<void> {
    try {
      // Get previous state for detecting state changes
      const previousState = await this.stateManager.loadAgentState(operationId);

      // Save step result
      await this.stateManager.saveStepResult(operationId, stepResult);

      // If status changes to done, send agent_runtime_end event
      // This ensures agent_runtime_end is sent after all step events
      if (stepResult.newState.status === 'done' && previousState?.status !== 'done') {
        await this.streamEventManager.publishAgentRuntimeEnd(
          operationId,
          stepResult.newState.stepCount,
          stepResult.newState,
        );
        log('[%s] Agent runtime completed', operationId);
      }
    } catch (error) {
      console.error('Failed to save step result and handle events:', error);
      throw error;
    }
  }

  /**
   * Get Agent state
   */
  async loadAgentState(operationId: string): Promise<AgentState | null> {
    return this.stateManager.loadAgentState(operationId);
  }

  /**
   * Get operation metadata
   */
  async getOperationMetadata(operationId: string): Promise<AgentOperationMetadata | null> {
    return this.stateManager.getOperationMetadata(operationId);
  }

  /**
   * Get execution history
   */
  async getExecutionHistory(operationId: string, limit?: number): Promise<any[]> {
    return this.stateManager.getExecutionHistory(operationId, limit);
  }

  /**
   * Delete Agent operation
   */
  async deleteAgentOperation(operationId: string): Promise<void> {
    try {
      await Promise.all([
        this.stateManager.deleteAgentOperation(operationId),
        this.streamEventManager.cleanupOperation(operationId),
      ]);
      log('Agent operation deleted: %s', operationId);
    } catch (error) {
      console.error('Failed to delete agent operation:', error);
      throw error;
    }
  }

  /**
   * Get active operations
   */
  async getActiveOperations(): Promise<string[]> {
    return this.stateManager.getActiveOperations();
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    activeOperations: number;
    completedOperations: number;
    errorOperations: number;
    totalOperations: number;
  }> {
    return this.stateManager.getStats();
  }

  /**
   * Clean up expired operations
   */
  async cleanupExpiredOperations(): Promise<number> {
    return this.stateManager.cleanupExpiredOperations();
  }

  /**
   * Close connections
   */
  async disconnect(): Promise<void> {
    await Promise.all([this.stateManager.disconnect(), this.streamEventManager.disconnect()]);
  }
}
