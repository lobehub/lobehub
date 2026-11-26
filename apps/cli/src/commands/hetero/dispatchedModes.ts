import type { spawnAgent } from '@lobechat/heterogeneous-agents/spawn';

import type { ResolvedPrompt } from './prompt';

type SpawnOptions = Parameters<typeof spawnAgent>[0];

/**
 * The run modes the dispatch envelope carried, as spawn
 * options for the agent they belong to: Claude Code's permission mode, and the
 * Codex Plan switch (collaboration mode).
 */
export const dispatchedModeSpawnOptions = (
  agentType: string,
  resolved: Pick<ResolvedPrompt, 'collaborationMode' | 'permissionMode'>,
): Pick<SpawnOptions, 'collaborationMode' | 'permissionMode'> => ({
  ...(agentType === 'claude-code' &&
    resolved.permissionMode && { permissionMode: resolved.permissionMode }),
  ...(agentType === 'codex' &&
    resolved.collaborationMode && { collaborationMode: resolved.collaborationMode }),
});
