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
  CodeBuddyAdapter,
  CodexAdapter,
  CursorAdapter,
  OpenCodeAdapter,
  PiAdapter,
  QoderAdapter,
} from './adapters';
import type { LocalHeterogeneousAgentType } from './config';
import type { AgentEventAdapter } from './types';

interface AgentRegistryEntry {
  createAdapter: () => AgentEventAdapter;
}

const localAgentRegistry = {
  'amp': {
    createAdapter: () => new AmpAdapter(),
  },
  'claude-code': {
    createAdapter: () => new ClaudeCodeAdapter(),
  },
  'codebuddy': {
    createAdapter: () => new CodeBuddyAdapter(),
  },
  'codex': {
    createAdapter: () => new CodexAdapter(),
  },
  'cursor': {
    createAdapter: () => new CursorAdapter(),
  },
  'opencode': {
    createAdapter: () => new OpenCodeAdapter(),
  },
  'pi': {
    createAdapter: () => new PiAdapter(),
  },
  'qoder': {
    createAdapter: () => new QoderAdapter(),
  },
  // 'kimi-cli': { createAdapter: () => new KimiCLIAdapter() },
} satisfies Record<LocalHeterogeneousAgentType, AgentRegistryEntry>;

const runtimeAdapterRegistry = {
  'claude-code-sdk': {
    createAdapter: () => new ClaudeCodeSdkAdapter(),
  },
} satisfies Record<string, AgentRegistryEntry>;

const registry: Record<string, AgentRegistryEntry> = {
  ...localAgentRegistry,
  ...runtimeAdapterRegistry,
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

/** Local CLI adapters that must match the shared descriptor catalog. */
export const listLocalAgentTypes = (): LocalHeterogeneousAgentType[] =>
  Object.keys(localAgentRegistry) as LocalHeterogeneousAgentType[];
