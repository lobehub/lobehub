/**
 * Lobe Skills Executor (Desktop)
 *
 * Desktop version: all commands run locally via localFileService.
 * No cloud sandbox, no exportFile.
 */
import { builtinSkills } from '@lobechat/builtin-skills';
import { SkillsExecutionRuntime } from '@lobechat/builtin-tool-skills/executionRuntime';
import { SkillsExecutor } from '@lobechat/builtin-tool-skills/executor';

import { filterBuiltinSkills } from '@/helpers/skillFilters';
import { localFileService } from '@/services/electron/localFileService';
import { agentSkillService } from '@/services/skill';

const runtime = new SkillsExecutionRuntime({
  builtinSkills: filterBuiltinSkills(builtinSkills),
  service: {
    execScript: async (command) => {
      const result = await localFileService.runCommand({ command, timeout: undefined });
      return {
        exitCode: result.exit_code ?? 1,
        output: result.stdout || result.output || '',
        stderr: result.stderr,
        success: result.success,
      };
    },
    findAll: () => agentSkillService.list(),
    findById: (id) => agentSkillService.getById(id),
    findByName: (name) => agentSkillService.getByName(name),
    readResource: (id, path) => agentSkillService.readResource(id, path),
  },
});

export const skillsExecutor = new SkillsExecutor(runtime);
