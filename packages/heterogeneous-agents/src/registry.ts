/**
 * Agent Adapter Registry
 *
 * Maps agent type keys to their adapter constructors. New agents are added
 * by registering here — no other code changes needed.
 */

import { ClaudeCodeAdapter, CodexAdapter } from './adapters';
import type { AgentEventAdapter } from './types';

interface AgentRegistryEntry {
  createAdapter: () => AgentEventAdapter;
}

const registry: Record<string, AgentRegistryEntry> = {
  'claude-code': {
    createAdapter: () => new ClaudeCodeAdapter(),
  },
  'codex': {
    createAdapter: () => new CodexAdapter(),
  },
  // 'kimi-cli': { createAdapter: () => new KimiCLIAdapter() },
};

/**
 * Create an adapter instance for the given agent type.
 */
export const createAdapter = (agentType: string): AgentEventAdapter => {
  const entry = registry[agentType];
  if (!entry) {
    throw new Error(
      `Unknown agent type: "${agentType}". Available: ${Object.keys(registry).join(', ')}`,
    );
  }
  return entry.createAdapter();
};

/**
 * List all registered agent types.
 */
export const listAgentTypes = (): string[] => Object.keys(registry);
