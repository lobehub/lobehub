import { SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import { PLUGIN_SCHEMA_SEPARATOR } from '@lobechat/const';
import type { LobeToolManifest, OperationSkillSet } from '@lobechat/context-engine';
import {
  applySkillsToolDeferral,
  canDeferSkillsTool,
  planSkillsToolDeferral,
} from '@lobechat/mecha';
import type { LobeAgentChatConfig, UIChatMessage } from '@lobechat/types';

import { applyShareGateToActivator } from '../shareGate/toolSet';
import { dropToolFromSet } from '../shareGate/toolSetMutation';
import type { ShareGateToolSet } from '../shareGate/types';

export interface DeferUnusedSkillsToolParams {
  agentChatConfig?: Pick<LobeAgentChatConfig, 'enableAgentMode' | 'toolMode'> | null;
  allMessages: UIChatMessage[];
  evalAllowedTools?: readonly string[];
  exclusivePluginIds?: readonly string[];
  isGoalTurn?: boolean;
  isShareRun?: boolean;
  /** `undefined` when the skill set could not be built, which never defers. */
  operationSkillSet?: OperationSkillSet;
  /**
   * The operation's tool set. `enabledToolIds` is optional because the tools
   * engine is not obliged to report it; a run without it is left untouched.
   */
  toolSet: Omit<ShareGateToolSet, 'enabledToolIds'> & {
    deferredManifestMap?: Record<string, LobeToolManifest>;
    enabledToolIds?: string[];
  };
}

const isExplicitlyAllowedByEval = (evalAllowedTools?: readonly string[]): boolean =>
  !!evalAllowedTools?.some(
    (entry) =>
      entry === SkillsIdentifier ||
      entry.startsWith(`${SkillsIdentifier}${PLUGIN_SCHEMA_SEPARATOR}`),
  );

/**
 * Start an Agent-mode run without the skill APIs of `lobe-skills` when it has
 * no skill to offer and the conversation never used one.
 *
 * The sandbox shell and `exportFile` stay enabled: they are the run's always-on
 * shell and do not depend on skills. Only `activateSkill` / `readReference` /
 * `execScript` leave, and the full manifest moves to `deferredManifestMap` so
 * installing a skill mid-run (`lobe-skill-store`) restores them on the next
 * step. On a routed device the tool has no shell to keep and leaves entirely.
 * Share runs cannot install skills, so there the tool is dropped outright.
 *
 * Mutates the tool set in place so `initialContext.payload.tools` and
 * `resolveOperationInitSlots` observe the same narrowed surface.
 */
export const deferUnusedSkillsTool = (params: DeferUnusedSkillsToolParams): boolean => {
  const {
    agentChatConfig,
    allMessages,
    evalAllowedTools,
    exclusivePluginIds,
    isGoalTurn = false,
    isShareRun = false,
    operationSkillSet,
    toolSet,
  } = params;
  const { enabledToolIds } = toolSet;

  if (!enabledToolIds?.includes(SkillsIdentifier)) return false;
  if (isGoalTurn) return false;
  if (exclusivePluginIds?.includes(SkillsIdentifier)) return false;
  if (isExplicitlyAllowedByEval(evalAllowedTools)) return false;
  if (toolSet.activatableToolIds.includes(SkillsIdentifier)) return false;
  if (
    !canDeferSkillsTool({
      chatConfig: agentChatConfig,
      hasSkills: operationSkillSet ? operationSkillSet.skills.length > 0 : undefined,
      messages: allMessages,
    })
  ) {
    return false;
  }

  const gatedToolSet = { ...toolSet, enabledToolIds };

  if (isShareRun) {
    dropToolFromSet(gatedToolSet, SkillsIdentifier);
    applyShareGateToActivator(gatedToolSet);
    return true;
  }

  const deferral = planSkillsToolDeferral(toolSet.manifestMap);
  if (!deferral) return false;

  applySkillsToolDeferral(gatedToolSet, deferral);
  toolSet.deferredManifestMap = gatedToolSet.deferredManifestMap;

  return true;
};
