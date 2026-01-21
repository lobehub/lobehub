/**
 * Builtin Tool Types
 *
 * Type definitions for the builtin tool execution framework.
 * Core types are re-exported from @lobechat/types for consistency.
 */

// Re-export core types from @lobechat/types
export type {
  AfterCompletionCallback,
  BuiltinToolContext,
  BuiltinToolExecutor,
  BuiltinToolResult,
  GroupOrchestrationBaseParams,
  GroupOrchestrationCallbacks,
  IBuiltinToolExecutor,
  TriggerBroadcastParams,
  TriggerDelegateParams,
  TriggerExecuteTaskItem,
  TriggerExecuteTasksParams,
  TriggerSpeakParams,
} from '@lobechat/types';

/**
 * Parameters for optimistic tool message update
 */
export interface OptimisticUpdateToolMessageParams {
  /**
   * The content to update
   */
  content?: string;

  /**
   * Error information to set
   */
  pluginError?: any;

  /**
   * Plugin state to set
   */
  pluginState?: any;
}
