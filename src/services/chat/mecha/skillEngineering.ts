import { SkillEngine } from '@lobechat/context-engine';

import { getToolStoreState } from '@/store/tool';

/**
 * Create a SkillEngine by merging all skill sources from toolStore
 *
 * Sources:
 * 1. Builtin skills (e.g., Artifacts) - from toolStore.builtinSkills
 * 2. DB skills (user/market) - from toolStore.agentSkills
 */
export const createSkillEngine = (): SkillEngine => {
  const toolState = getToolStoreState();

  // Source 1: builtin skills
  const builtinMetas = (toolState.builtinSkills || []).map((s) => ({
    description: s.description,
    identifier: s.identifier,
    name: s.name,
  }));

  // Source 2: DB skills (agentSkills table)
  const dbMetas = (toolState.agentSkills || []).map((s) => ({
    description: s.description ?? '',
    identifier: s.identifier,
    name: s.name,
  }));

  return new SkillEngine({ skills: [...builtinMetas, ...dbMetas] });
};
