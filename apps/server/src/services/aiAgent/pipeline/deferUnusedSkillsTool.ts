import { hasHistoricalToolInvocation } from '@lobechat/agent-runtime';
import {
  getSystemPrompt as getActivatorSystemPrompt,
  getSystemPromptForShareVisitor as getActivatorSystemPromptForShareVisitor,
  LobeActivatorIdentifier,
  systemPrompt as activatorSystemPrompt,
} from '@lobechat/builtin-tool-activator';
import { SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import { PLUGIN_SCHEMA_SEPARATOR } from '@lobechat/const';
import type {
  LobeToolManifest,
  OperationSkillSet,
  ToolExecutor,
  ToolSource,
} from '@lobechat/context-engine';
import { type LobeAgentChatConfig, resolveToolMode, type UIChatMessage } from '@lobechat/types';

import {
  dropToolFromSet,
  generateOwnedToolNames,
  pruneArrayInPlace,
} from '../shareGate/toolSetMutation';

export interface DeferUnusedSkillsToolParams {
  activatableToolIds: string[];
  agentChatConfig?: Pick<LobeAgentChatConfig, 'enableAgentMode' | 'toolMode'> | null;
  allMessages: UIChatMessage[];
  enabledToolIds: string[];
  evalAllowedTools?: readonly string[];
  exclusivePluginIds?: readonly string[];
  executorMap: Record<string, ToolExecutor>;
  isGoalTurn?: boolean;
  isShareRun?: boolean;
  manifestMap: Record<string, LobeToolManifest>;
  operationSkillSet?: OperationSkillSet;
  sourceMap: Record<string, ToolSource>;
  tools?: Array<{ function?: { name?: string } }>;
}

const isExplicitlyAllowedByEval = (evalAllowedTools?: readonly string[]): boolean =>
  !!evalAllowedTools?.some(
    (entry) =>
      entry === SkillsIdentifier ||
      entry.startsWith(`${SkillsIdentifier}${PLUGIN_SCHEMA_SEPARATOR}`),
  );

/**
 * Defer `lobe-skills` out of the initial enabled tool set when an Agent-mode
 * run starts with zero available skills and no prior `lobe-skills` usage in
 * conversation history.
 *
 * Keeps the resolved manifest in `manifestMap` on normal runs so mid-operation
 * skill installation (`lobe-skill-store`) or explicit activation can enable
 * `lobe-skills` on the next step without re-running discovery. Share runs never
 * allow `lobe-skill-store`, so when zero skills survive they drop it outright.
 *
 * Mutates the operation tool-set arrays/maps in place so `initialContext.payload.tools`
 * and `resolveOperationInitSlots` observe the exact same pruned surface.
 */
export const deferUnusedSkillsTool = (params: DeferUnusedSkillsToolParams): boolean => {
  const {
    activatableToolIds,
    agentChatConfig,
    allMessages,
    enabledToolIds,
    evalAllowedTools,
    exclusivePluginIds,
    executorMap,
    isGoalTurn = false,
    isShareRun = false,
    manifestMap,
    operationSkillSet,
    sourceMap,
    tools,
  } = params;

  if (!enabledToolIds.includes(SkillsIdentifier)) return false;
  if (isGoalTurn || resolveToolMode(agentChatConfig) !== 'agent') return false;
  if (exclusivePluginIds?.includes(SkillsIdentifier)) return false;
  if (isExplicitlyAllowedByEval(evalAllowedTools)) return false;
  if ((operationSkillSet?.skills?.length ?? 0) > 0) return false;
  if (activatableToolIds.includes(SkillsIdentifier)) return false;
  if (hasHistoricalToolInvocation(allMessages, SkillsIdentifier)) return false;

  const toolSet = {
    activatableToolIds,
    enabledToolIds,
    executorMap,
    manifestMap,
    sourceMap,
    tools,
  };

  if (isShareRun) {
    dropToolFromSet(toolSet, SkillsIdentifier);

    const activatorManifest = manifestMap[LobeActivatorIdentifier];
    if (activatorManifest) {
      const enabled = new Set([...enabledToolIds, ...activatableToolIds]);
      const hasActivatableTool = Object.keys(manifestMap).some(
        (id) => id !== LobeActivatorIdentifier && !enabled.has(id),
      );

      if (!hasActivatableTool) {
        dropToolFromSet(toolSet, LobeActivatorIdentifier);
      } else {
        manifestMap[LobeActivatorIdentifier] = {
          ...activatorManifest,
          systemRole: getActivatorSystemPromptForShareVisitor({ withSkills: false }),
        };
      }
    }

    return true;
  }

  const ownedNames = generateOwnedToolNames(SkillsIdentifier, manifestMap[SkillsIdentifier]);
  pruneArrayInPlace(enabledToolIds, (id) => id !== SkillsIdentifier);
  if (tools) {
    pruneArrayInPlace(tools, (tool) => {
      const name = tool?.function?.name;
      if (!name) return true;
      return !(ownedNames.has(name) || name.split(PLUGIN_SCHEMA_SEPARATOR)[0] === SkillsIdentifier);
    });
  }

  const activatorManifest = manifestMap[LobeActivatorIdentifier];
  if (activatorManifest && activatorManifest.systemRole === activatorSystemPrompt) {
    manifestMap[LobeActivatorIdentifier] = {
      ...activatorManifest,
      systemRole: getActivatorSystemPrompt({ withSkills: false }),
    };
  }

  return true;
};
