import type { AgentState } from '@lobechat/agent-runtime';
import { SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import {
  applySkillsToolDeferral,
  canDeferSkillsTool,
  planSkillsToolDeferral,
} from '@lobechat/mecha';
import type { UIChatMessage } from '@lobechat/types';

import type { ResolvedAgentConfig } from '@/services/chat/mecha';
import { resolveClientRunHasSkills } from '@/services/chat/mecha/skillEngineering';

interface ClientRun {
  agentConfig: ResolvedAgentConfig;
  state: AgentState;
}

/**
 * Start a client-side run without the skill APIs of `lobe-skills` when it has
 * no skill to offer, as the server does (`deferUnusedSkillsTool`).
 *
 * The sandbox shell and `exportFile` stay enabled. The full manifest moves to
 * `operationToolSet.deferredManifestMap`, where installing a skill mid-run
 * promotes it back. Returns the run untouched whenever it does not qualify.
 *
 * A resumed run (after a tool approval) keeps the surface it started with: its
 * state already says whether it deferred, so only the freshly rebuilt agent
 * config is narrowed again and the skill list is not consulted a second time.
 */
export const deferClientSkillsTool = async <Run extends ClientRun>(
  run: Run,
  {
    agentId,
    disableTools,
    messages,
    resumed,
  }: {
    /** The agent whose profile the context build reads skills from. */
    agentId?: string;
    disableTools?: boolean;
    messages: UIChatMessage[];
    /** The run continues an existing state instead of starting one. */
    resumed?: boolean;
  },
): Promise<Run> => {
  const { agentConfig, state } = run;
  const { chatConfig, enabledToolIds } = agentConfig;
  const { operationToolSet } = state;

  if (disableTools || !operationToolSet || !enabledToolIds?.includes(SkillsIdentifier)) return run;

  const startedDeferred = !!operationToolSet.deferredManifestMap?.[SkillsIdentifier];
  if (resumed && !startedDeferred) return run;

  if (!resumed) {
    // The skill list is only looked up for a run that could defer at all.
    if (!canDeferSkillsTool({ chatConfig, hasSkills: false, messages })) return run;

    const hasSkills = await resolveClientRunHasSkills({ agentConfig, agentId, messages });
    if (!canDeferSkillsTool({ chatConfig, hasSkills, messages })) return run;
  }

  const promptToolSet = {
    enabledToolIds: [...enabledToolIds],
    manifestMap: Object.fromEntries(
      (agentConfig.enabledManifests ?? []).map((manifest) => [manifest.identifier, manifest]),
    ),
    tools: [...(agentConfig.tools ?? [])],
  };
  const deferral = planSkillsToolDeferral(promptToolSet.manifestMap);
  if (!deferral) return run;

  applySkillsToolDeferral(promptToolSet, deferral);
  const narrowedAgentConfig = {
    ...agentConfig,
    enabledManifests: Object.values(promptToolSet.manifestMap),
    enabledToolIds: promptToolSet.enabledToolIds,
    tools: promptToolSet.tools.length > 0 ? promptToolSet.tools : undefined,
  };
  if (resumed) return { ...run, agentConfig: narrowedAgentConfig };

  // The state's set is wider than the prompt's (it also holds what the
  // activator can discover), so it is narrowed separately with the same plan.
  const deferredToolSet = {
    ...operationToolSet,
    enabledToolIds: [...operationToolSet.enabledToolIds],
    manifestMap: { ...operationToolSet.manifestMap },
    tools: [...operationToolSet.tools],
  };
  applySkillsToolDeferral(deferredToolSet, deferral);

  return {
    ...run,
    agentConfig: narrowedAgentConfig,
    state: { ...state, operationToolSet: deferredToolSet },
  };
};
