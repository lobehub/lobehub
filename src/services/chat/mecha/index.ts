/**
 * Mecha - Core AI execution module
 *
 * This module provides the core functionality for AI agent execution,
 * including agent configuration resolution, context engineering,
 * model parameter handling, and memory management.
 */

// Agent configuration
export type { AgentConfigResolverContext, ResolvedAgentConfig } from './agentConfigResolver';
export { getTargetAgentId, resolveAgentConfig } from './agentConfigResolver';

// Context engineering
export { contextEngineering } from './contextEngineering';

// Client model runtime
export { initializeWithClientStore } from './clientModelRuntime';

// Model parameters
export type { ModelExtendParams, ModelParamsContext } from './modelParamsResolver';
export { resolveModelExtendParams } from './modelParamsResolver';

// Memory management
export type { TopicMemoryResolverContext } from './memoryManager';
export {
  combineUserMemoryData,
  resolveGlobalIdentities,
  resolveTopicMemories,
} from './memoryManager';
