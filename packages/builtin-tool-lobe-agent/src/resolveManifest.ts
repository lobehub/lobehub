import type {
  BuiltinManifestResolver,
  BuiltinToolManifest,
  InjectedToolManifest,
} from '@lobechat/types';

import { LobeAgentManifest } from './manifest';
import { delegationSystemPrompt, systemPromptWithoutSubAgent } from './systemRole';
import { LobeAgentApiName, LobeAgentIdentifier } from './types';

/**
 * Sub-agent dispatch and control: hidden together, never one without the other.
 * The share-visitor gate strips the same set.
 */
export const LOBE_AGENT_SUB_AGENT_APIS: ReadonlySet<string> = new Set<string>([
  LobeAgentApiName.callSubAgent,
  LobeAgentApiName.cancelSubAgent,
]);

const callSubAgentApi = LobeAgentManifest.api.find(
  (api) => api.name === LobeAgentApiName.callSubAgent,
)!;

/**
 * `callSubAgent` with `agentId` required: the delegation-only surface hands
 * work to a named agent, never to an anonymous copy of the caller.
 */
const delegationCallSubAgentApi: BuiltinToolManifest['api'][number] = {
  ...callSubAgentApi,
  description:
    "Hand work to another of the user's agents (including external agents such as Claude Code). It runs in an isolated context with its own model and tools, and its answer comes back as the result. Pass `subAgentId` to send a follow-up to an earlier one instead of starting a new one.",
  parameters: {
    ...callSubAgentApi.parameters,
    required: ['agentId', 'description', 'instruction'],
  },
};

/**
 * Delegation-only `lobe-agent`: just `callSubAgent` with a target agent. Used
 * where the full tool is not offered but the user @mentioned agents — chat
 * mode on the server (via {@link resolveLobeAgentManifest}) and the client
 * runtime's per-turn injection ({@link createLobeAgentDelegationManifest}).
 */
export const LobeAgentDelegationManifest: BuiltinToolManifest = {
  ...LobeAgentManifest,
  api: [delegationCallSubAgentApi],
  systemRole: delegationSystemPrompt,
};

/**
 * The delegation-only manifest as a per-turn injection, for the client runtime
 * when the user @mentions agents. Merged by identifier, so a run that already
 * carries the full `lobe-agent` keeps it.
 */
export const createLobeAgentDelegationManifest = (): InjectedToolManifest => ({
  api: LobeAgentDelegationManifest.api.map(({ description, name, parameters }) => ({
    description,
    name,
    parameters,
  })),
  identifier: LobeAgentIdentifier,
  meta: { description: 'Delegate tasks to other agents', title: 'Lobe Agent' },
  systemRole: LobeAgentDelegationManifest.systemRole,
  type: 'builtin',
});

/**
 * Context-aware manifest for the lobe-agent tool.
 *
 * `lobe-agent` bundles plan / todo / media-analysis APIs together with the
 * `callSubAgent` dispatch. The dispatch must be hidden in two contexts:
 *
 * - **Inside a group** (`scope` is `group` / `group_agent`): coordination already
 *   happens through real member agents via GroupManagement; an isolated ad-hoc
 *   sub-agent on top of that is redundant and confusing.
 * - **Inside a sub-agent** (`isSubAgent`): a nested sub-agent must not spawn
 *   further sub-agents.
 *
 * In both cases plan / todo / media-analysis APIs stay available, so this returns a
 * trimmed manifest (not `null`). It rewrites BOTH halves of the manifest in step:
 * the `api` list drops `callSubAgent` (and `cancelSubAgent`), and `systemRole` switches to the variant
 * without the sub-agent section — otherwise the prompt would keep instructing the
 * model to dispatch a tool that is no longer in its tool list.
 *
 * In chat mode the tool is only admitted to delegate to @mentioned agents, so
 * it becomes the delegation-only manifest.
 */
export const resolveLobeAgentManifest: BuiltinManifestResolver = (context) => {
  const inGroup = context.scope === 'group' || context.scope === 'group_agent';
  const hideSubAgentDispatch = inGroup || context.isSubAgent === true;

  if (context.toolMode === 'chat') return hideSubAgentDispatch ? null : LobeAgentDelegationManifest;

  if (!hideSubAgentDispatch) return LobeAgentManifest;

  return {
    ...LobeAgentManifest,
    api: LobeAgentManifest.api.filter((api) => !LOBE_AGENT_SUB_AGENT_APIS.has(api.name)),
    systemRole: systemPromptWithoutSubAgent,
  };
};
