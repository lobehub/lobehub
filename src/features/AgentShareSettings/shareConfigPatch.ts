import type { AgentShareConfigPatchInput } from '@/services/agentShare';

import type { AgentShareConfigState } from './useAgentShare';

/**
 * Client-side mirror of `AgentShareModel.updateConfig`'s jsonb merge: a key
 * present in the patch overwrites the base value, and an `undefined` value is
 * "not part of this patch" — the server skips it, so the base value stands.
 *
 * Used to keep a local copy of the config in step with writes that are still
 * in flight, so a second edit composes on top of the first instead of being
 * derived from a snapshot the server has already moved past.
 */
export const mergeShareConfig = (
  base: AgentShareConfigState,
  patch: AgentShareConfigPatchInput,
): AgentShareConfigState => {
  const patched = Object.entries(patch).filter(([, value]) => value !== undefined);

  return Object.assign({ ...base }, Object.fromEntries(patched));
};
