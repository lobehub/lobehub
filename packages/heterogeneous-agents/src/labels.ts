import { HETEROGENEOUS_AGENT_CONFIGS, REMOTE_HETEROGENEOUS_AGENT_CONFIGS } from './config';

/**
 * Display-name mapping for all heterogeneous agent types (local CLI + remote platform).
 *
 * Keys mirror the registry keys in `registry.ts` (adapter type). UI layers
 * use this to render user-facing names (e.g. "Claude Code is running")
 * without knowing adapter-specific branding.
 * Add new types to HETEROGENEOUS_AGENT_CONFIGS or REMOTE_HETEROGENEOUS_AGENT_CONFIGS
 * in config.ts to automatically include them here.
 */
export const HETEROGENEOUS_TYPE_LABELS: Record<string, string> = Object.fromEntries([
  ...HETEROGENEOUS_AGENT_CONFIGS.map((config) => [config.type, config.title]),
  ...REMOTE_HETEROGENEOUS_AGENT_CONFIGS.map((config) => [config.type, config.title]),
]);
