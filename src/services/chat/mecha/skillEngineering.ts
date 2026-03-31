import type { OperationSkillSet } from '@lobechat/context-engine';
import { SkillEngine } from '@lobechat/context-engine';

import { isBuiltinSkillAvailableInCurrentEnv } from '@/helpers/toolAvailability';
import { getToolStoreState } from '@/store/tool';

/**
 * Build a client-side OperationSkillSet via SkillEngine.
 *
 * Sources:
 * 1. Builtin skills (e.g., Artifacts) - from toolStore.builtinSkills
 * 2. DB skills (user/market) - from toolStore.agentSkills
 *
 * Uses isBuiltinSkillAvailableInCurrentEnv as the enableChecker to
 * filter platform-specific skills (e.g., agent-browser on desktop only).
 */
export const resolveClientSkills = (pluginIds?: string[]): OperationSkillSet => {
  const toolState = getToolStoreState();

  const builtinMetas = (toolState.builtinSkills || []).map((s) => ({
    description: s.description,
    identifier: s.identifier,
    name: s.name,
  }));

  const dbMetas = (toolState.agentSkills || []).map((s) => ({
    description: s.description ?? '',
    identifier: s.identifier,
    name: s.name,
  }));

  const skillEngine = new SkillEngine({
    enableChecker: (skill) => isBuiltinSkillAvailableInCurrentEnv(skill.identifier),
    skills: [...builtinMetas, ...dbMetas],
  });

  return skillEngine.generate(pluginIds ?? []);
};
