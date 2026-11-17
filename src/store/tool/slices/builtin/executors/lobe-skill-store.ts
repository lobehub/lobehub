/**
 * Lobe Skill Store Executor
 *
 * Creates and exports the SkillStoreExecutor instance for registration.
 * Handles skill search and import from market/URL.
 */
import { SkillStoreExecutionRuntime } from '@lobechat/builtin-tool-skill-store/executionRuntime';
import { SkillStoreExecutor } from '@lobechat/builtin-tool-skill-store/executor';
import { LIBRARY_SKILL_IMPLICIT_MODE, parsePluginEntry } from '@lobechat/types';

import { marketApiService } from '@/services/marketApi';
import { agentSkillService } from '@/services/skill';

/**
 * A library skill is opt-in per agent, so a skill the model installs mid-run
 * would be off for the very agent that installed it. Set it to Auto there,
 * unless the agent already has an entry: a pin or an explicit disable is the
 * user's own choice and a re-import must not undo it.
 */
const turnOnForActiveAgent = async (skill: { identifier: string }) => {
  // Dynamic import to avoid circular dependency (this file is inside the tool store)
  const { getAgentStoreState } = await import('@/store/agent/store');
  const { agentSelectors } = await import('@/store/agent/selectors');
  const agentState = getAgentStoreState();
  const plugins = agentSelectors.currentAgentConfig(agentState)?.plugins ?? [];
  if (plugins.some((entry) => parsePluginEntry(entry).identifier === skill.identifier)) return;

  await agentState.setPluginMode(skill.identifier, 'auto', LIBRARY_SKILL_IMPLICIT_MODE);
};

// Create runtime with client-side service
const runtime = new SkillStoreExecutionRuntime({
  service: {
    importFromGitHub: async (gitUrl) => {
      const result = await agentSkillService.importFromGitHub({ gitUrl });
      if (!result) throw new Error('Import failed');
      await turnOnForActiveAgent(result.skill);
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    },
    importFromMarket: async (identifier) => {
      const result = await agentSkillService.importFromMarket(identifier);
      if (!result) throw new Error('Import failed');
      await turnOnForActiveAgent(result.skill);
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    },
    importFromUrl: async (url) => {
      const result = await agentSkillService.importFromUrl({ url });
      if (!result) throw new Error('Import failed');
      await turnOnForActiveAgent(result.skill);
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    },
    importFromZipUrl: async (url) => {
      const result = await agentSkillService.importFromUrl({ url });
      if (!result) throw new Error('Import failed');
      await turnOnForActiveAgent(result.skill);
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    },
    onSkillImported: async () => {
      // Dynamic import to avoid circular dependency (this file is inside the tool store)
      const { getToolStoreState } = await import('@/store/tool/store');
      await getToolStoreState().refreshAgentSkills();
    },
    searchSkill: async (params) => {
      const result = await marketApiService.searchSkill({
        ...params,
        // Only pass sort if it's a valid SkillSorts value
        sort: params.sort as any,
      });
      // Transform SDK response to match expected interface
      return {
        items: result.items,
        page: result.currentPage,
        pageSize: result.pageSize,
        total: result.totalCount,
      };
    },
  },
});

// Create executor instance with the runtime
export const skillStoreExecutor = new SkillStoreExecutor(runtime);
