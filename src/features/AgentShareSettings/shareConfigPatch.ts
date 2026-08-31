import type { AgentShareConfigPatchInput } from '@/services/agentShare';

import type { AgentShareConfigState } from './useAgentShare';

/**
 * Client-side mirror of `AgentShareModel.updateConfig`'s jsonb merge: a
 * `null`/`undefined` value REMOVES the key (back to "unset"), everything else
 * overwrites it.
 *
 * Used to keep a local copy of the config in step with writes that are still
 * in flight, so a second edit composes on top of the first instead of being
 * derived from a snapshot the server has already moved past.
 */
export const mergeShareConfig = (
  base: AgentShareConfigState,
  patch: AgentShareConfigPatchInput,
): AgentShareConfigState => {
  const next: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }

  return next as AgentShareConfigState;
};
