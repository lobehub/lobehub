/**
 * Agent Adapter Registry
 *
 * Maps agent type keys to their adapter constructors. New agents are added
 * by registering here — no other code changes needed.
 */

import {
  AmpAdapter,
  ClaudeCodeAdapter,
  ClaudeCodeSdkAdapter,
  CodexAdapter,
  OpenCodeAdapter,
} from './adapters';
import type { AgentEventAdapter } from './types';

interface AgentRegistryEntry {
  createAdapter: () => AgentEventAdapter;
}

const registry: Record<string, AgentRegistryEntry> = {
  'amp': {
    createAdapter: () => new AmpAdapter(),
  },
  'claude-code': {
    createAdapter: () => new ClaudeCodeAdapter(),
  },
  'claude-code-sdk': {
    createAdapter: () => new ClaudeCodeSdkAdapter(),
  },
  'codex': {
    createAdapter: () => new CodexAdapter(),
  },
  'opencode': {
    createAdapter: () => new OpenCodeAdapter(),
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
