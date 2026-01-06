/**
 * Mecha Server Module
 *
 * This module provides server-side implementations for AI agent execution,
 * mirroring the frontend Mecha functionality but with database-driven data sources.
 *
 * Components:
 * - AgentToolsEngine: Server-side tools generation engine
 * - ContextEngineering: Server-side messages engine for context processing
 */

// Agent Tools Engine
export type {
  InstalledPlugin,
  ServerAgentToolsContext,
  ServerAgentToolsEngineConfig,
  ServerCreateAgentToolsEngineParams,
} from './AgentToolsEngine';
export { createServerAgentToolsEngine, createServerToolsEngine } from './AgentToolsEngine';

// Context Engineering (Messages Engine)
export type {
  ServerKnowledgeConfig,
  ServerMessagesEngineParams,
  ServerModelCapabilities,
  ServerToolsConfig,
  ServerUserMemoryConfig,
} from './ContextEngineering';
export { serverMessagesEngine } from './ContextEngineering';
