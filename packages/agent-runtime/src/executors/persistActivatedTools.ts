import type { ChatToolPayload } from '@lobechat/types';

import type { ToolRunResult } from '../transport';
import type { AgentState } from '../types';
import { persistAgentFileDiscoveries } from '../utils/discoveredAgentFiles';

/** The fields of a settled tool call these records read. */
export interface ActivationResultEntry {
  data: ToolRunResult;
  isSuccess: boolean;
  toolCall: ChatToolPayload;
  toolCallId: string;
}

const SKILLS_IDENTIFIER = 'lobe-skills';
const SKILL_STORE_IDENTIFIER = 'lobe-skill-store';
const ACTIVATOR_IDENTIFIER = 'lobe-activator';
const SKILL_STORE_IMPORT_APIS = new Set(['importFromMarket', 'importSkill']);

const shouldAutoActivateSkillsTool = (result: ActivationResultEntry): boolean => {
  if (!result.isSuccess) return false;
  if (
    result.toolCall.identifier === SKILL_STORE_IDENTIFIER &&
    SKILL_STORE_IMPORT_APIS.has(result.toolCall.apiName)
  ) {
    return true;
  }

  return (
    result.toolCall.identifier === ACTIVATOR_IDENTIFIER &&
    result.toolCall.apiName === 'activateTools' &&
    Array.isArray(result.data.state?.activatedSkills) &&
    result.data.state.activatedSkills.length > 0
  );
};

/**
 * Record what a step's tool results unlocked for later steps: tools a
 * discovery activated (`state.activatedStepTools`), and agent files a device
 * file tool found in a directory the run had not scanned
 * (`state.discoveredAgentFiles`).
 */
export const persistActivatedTools = ({
  effectiveManifestMap,
  newState,
  results,
  stepCount,
}: {
  effectiveManifestMap: Record<string, any>;
  newState: AgentState;
  results: ActivationResultEntry[];
  stepCount: number;
}) => {
  persistAgentFileDiscoveries(
    newState,
    results.map((result) => result.data.state),
  );

  const existingIds = new Set((newState.activatedStepTools ?? []).map((tool) => tool.id));
  const deferredManifestMap = newState.operationToolSet?.deferredManifestMap ?? {};

  for (const result of results) {
    const discoveredTools = (
      (result.data.state?.activatedTools as Array<{ identifier: string }> | undefined) ?? []
    ).map((tool) => tool.identifier);

    // A run that starts without skills defers the skill APIs of `lobe-skills`
    // (`operationToolSet.deferredManifestMap`). Once this operation installs a
    // skill, or activates one through the activator's skill fallback, promote
    // the tool so the next LLM call can invoke `activateSkill` /
    // `readReference` / `execScript`.
    if (shouldAutoActivateSkillsTool(result) && deferredManifestMap[SKILLS_IDENTIFIER]) {
      discoveredTools.push(SKILLS_IDENTIFIER);
    }

    if (discoveredTools.length === 0) continue;

    // The set is updated inside the filter, not after mapping the batch: two
    // results in the same step (or one result listing the same tool twice)
    // would otherwise both pass and be appended twice.
    const newActivations = discoveredTools
      .filter((identifier) => {
        if (existingIds.has(identifier)) return false;
        existingIds.add(identifier);
        return true;
      })
      .map((identifier) => ({
        activatedAtStep: stepCount,
        afterToolCallId: result.toolCallId,
        id: identifier,
        manifest: effectiveManifestMap[identifier],
        source: 'discovery' as const,
      }));

    if (newActivations.length > 0) {
      newState.activatedStepTools = [...(newState.activatedStepTools ?? []), ...newActivations];
    }
  }
};
