/**
 * Agent Adapter Registry
 *
 * Maps agent type keys to their adapter constructors and CLI presets.
 * New agents are added by registering here — no other code changes needed.
 */

import { ClaudeCodeAdapter, claudeCodePreset } from './adapters';
import type { AgentCLIPreset, AgentEventAdapter } from './types';

interface AgentRegistryEntry {
  createAdapter: () => AgentEventAdapter;
  preset: AgentCLIPreset;
}

const registry: Record<string, AgentRegistryEntry> = {
  'claude-code': {
    createAdapter: () => new ClaudeCodeAdapter(),
    preset: claudeCodePreset,
  },
  // Future:
  // 'codex': { createAdapter: () => new CodexAdapter(), preset: codexPreset },
  // 'kimi-cli': { createAdapter: () => new KimiCLIAdapter(), preset: kimiPreset },
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
 * Get the CLI preset for the given agent type.
 */
export const getPreset = (agentType: string): AgentCLIPreset => {
  const entry = registry[agentType];
  if (!entry) {
    throw new Error(
      `Unknown agent type: "${agentType}". Available: ${Object.keys(registry).join(', ')}`,
    );
  }
  return entry.preset;
};

/**
 * List all registered agent types.
 */
export const listAgentTypes = (): string[] => Object.keys(registry);
