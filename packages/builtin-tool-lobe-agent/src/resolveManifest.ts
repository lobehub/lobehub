import type { BuiltinManifestResolver } from '@lobechat/types';

import { LobeAgentManifest } from './manifest';
import { LobeAgentApiName } from './types';

/**
 * Context-aware manifest for the lobe-agent tool.
 *
 * `lobe-agent` bundles plan / todo / visual-media APIs together with the
 * `callSubAgent` dispatch. The dispatch must be hidden in two contexts:
 *
 * - **Inside a group** (`scope` is `group` / `group_agent`): coordination already
 *   happens through real member agents via GroupManagement; an isolated ad-hoc
 *   sub-agent on top of that is redundant and confusing.
 * - **Inside a sub-agent** (`isSubAgent`): a nested sub-agent must not spawn
 *   further sub-agents.
 *
 * In both cases only `callSubAgent` is removed — plan / todo / visual-media stay
 * available — so this returns a trimmed manifest rather than `null`.
 */
export const resolveLobeAgentManifest: BuiltinManifestResolver = (context) => {
  const inGroup = context.scope === 'group' || context.scope === 'group_agent';
  const hideSubAgentDispatch = inGroup || context.isSubAgent === true;

  if (!hideSubAgentDispatch) return LobeAgentManifest;

  return {
    ...LobeAgentManifest,
    api: LobeAgentManifest.api.filter((api) => api.name !== LobeAgentApiName.callSubAgent),
  };
};
