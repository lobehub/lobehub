/**
 * Lobe Skill Store Executor
 *
 * Creates and exports the SkillStoreExecutor instance for registration.
 * Handles skill search and import from market/URL.
 */
import { SkillStoreExecutionRuntime } from '@lobechat/builtin-tool-skill-store/executionRuntime';
import { SkillStoreExecutor } from '@lobechat/builtin-tool-skill-store/executor';

import { marketApiService } from '@/services/marketApi';
import { agentSkillService } from '@/services/skill';

// Create runtime with client-side service
const runtime = new SkillStoreExecutionRuntime({
  service: {
    importFromGitHub: async (gitUrl) => {
      const result = await agentSkillService.importFromGitHub({ gitUrl });
      if (!result) throw new Error('Import failed');
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    },
    importFromMarket: async (identifier) => {
      const result = await agentSkillService.importFromMarket(identifier);
      if (!result) throw new Error('Import failed');
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    },
    importFromUrl: async (url) => {
      const result = await agentSkillService.importFromUrl({ url });
      if (!result) throw new Error('Import failed');
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    },
    importFromZipUrl: async (url) => {
      const result = await agentSkillService.importFromUrl({ url });
      if (!result) throw new Error('Import failed');
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    },
    onSkillImported: async () => {
      // Dynamic import to avoid circular dependency (this file is inside the tool store)
      const { getToolStoreState } = await import('@/store/tool/store');
      await getToolStoreState().refreshAgentSkills();
    },
    searchSkill: async (params) => {
      return marketApiService.searchSkill(params);
    },
  },
});

// Create executor instance with the runtime
export const skillStoreExecutor = new SkillStoreExecutor(runtime);
