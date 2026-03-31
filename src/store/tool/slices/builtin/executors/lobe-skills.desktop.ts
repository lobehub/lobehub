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
import { desktopSkillRuntimeService } from '@/services/electron/desktopSkillRuntime';
import { localFileService } from '@/services/electron/localFileService';
import { agentSkillService } from '@/services/skill';

const runtime = new SkillsExecutionRuntime({
  builtinSkills: filterBuiltinSkills(builtinSkills),
  service: {
    execScript: async (command, options) => {
      const cwd = await desktopSkillRuntimeService.resolveExecutionDirectory(
        options.activatedSkills,
      );
      const result = await localFileService.runCommand({ command, cwd, timeout: undefined });
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
    readResource: async (id, path) => {
      const resource = await agentSkillService.readResource(id, path);
      const fullPath = await desktopSkillRuntimeService.resolveReferenceFullPath({
        path,
        skillId: id,
      });

      return {
        ...resource,
        fullPath,
      };
    },
  },
});

export const skillsExecutor = new SkillsExecutor(runtime);
