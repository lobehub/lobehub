import type { BuiltinManifestResolver } from '@lobechat/types';

import { LobeAgentManifest } from './manifest';
import { systemPromptMediaOnly, systemPromptWithoutSubAgent } from './systemRole';
import { LobeAgentApiName } from './types';

/** The only lobe-agent APIs a Quick Note run can call. */
const QUICK_NOTE_API_NAMES = new Set<string>([LobeAgentApiName.analyzeMedia]);

/**
 * Context-aware manifest for the lobe-agent tool.
 *
 * `lobe-agent` bundles plan / todo / media-analysis APIs together with the
 * `callSubAgent` dispatch. The dispatch must be hidden in these contexts:
 *
 * - **Inside a group** (`scope` is `group` / `group_agent`): coordination already
 *   happens through real member agents via GroupManagement; an isolated ad-hoc
 *   sub-agent on top of that is redundant and confusing.
 * - **Inside a sub-agent** (`isSubAgent`): a nested sub-agent must not spawn
 *   further sub-agents.
 *
 * Quick Note (`scope` is `quick_note`) is narrower still: only `analyzeMedia` is exposed, with
 * a prompt that describes just that tool.
 *
 * In these cases plan / todo / media-analysis APIs stay available, so this returns a
 * trimmed manifest (not `null`). It rewrites BOTH halves of the manifest in step:
 * the `api` list drops `callSubAgent`, and `systemRole` switches to the variant
 * without the sub-agent section — otherwise the prompt would keep instructing the
 * model to dispatch a tool that is no longer in its tool list.
 */
export const resolveLobeAgentManifest: BuiltinManifestResolver = (context) => {
  // Quick Note works on one note: it may inspect attached media, but never plans, keeps todos,
  // asks the user, or delegates. Trimming the manifest keeps those tools out of the tool list
  // instead of relying on prompt rules.
  if (context.scope === 'quick_note') {
    return {
      ...LobeAgentManifest,
      api: LobeAgentManifest.api.filter((api) => QUICK_NOTE_API_NAMES.has(api.name)),
      systemRole: systemPromptMediaOnly,
    };
  }

  const inGroup = context.scope === 'group' || context.scope === 'group_agent';
  const hideSubAgentDispatch = inGroup || context.isSubAgent === true;

  if (!hideSubAgentDispatch) return LobeAgentManifest;

  return {
    ...LobeAgentManifest,
    api: LobeAgentManifest.api.filter((api) => api.name !== LobeAgentApiName.callSubAgent),
    systemRole: systemPromptWithoutSubAgent,
  };
};
