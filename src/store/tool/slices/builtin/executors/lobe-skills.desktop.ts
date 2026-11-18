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
      const skillDir = await desktopSkillRuntimeService.resolveExecutionDirectory(
        options.activatedSkills,
      );
      // A Local Sandbox run is fenced to the agent's working directory, never
      // to the skill directory: that is the device's shared skill cache, and a
      // writable cache would let a fenced run plant code a later unfenced run
      // executes. The script still starts in its skill directory (reads are not
      // fenced). Unfenced runs keep the historical skill-directory-only cwd.
      if (options.localSandbox && !options.workingDirectory) {
        return {
          executionEnv: 'device' as const,
          exitCode: 1,
          output: '',
          stderr:
            'Local Sandbox requires a working directory. Set one for this agent (or topic) and run the command again.',
          success: false,
        };
      }
      const result = await localFileService.runCommand({
        command,
        cwd: options.localSandbox ? (skillDir ?? options.workingDirectory) : skillDir,
        description: options.description,
        ...(options.localSandbox && {
          sandbox: true,
          sandboxNetwork: options.localSandboxNetwork === true,
          sandboxRoot: options.workingDirectory,
        }),
        timeout: undefined,
      });
      return {
        // Desktop commands run on the user's machine — stamp the execution env
        // so the file-edit scanner treats produced files as device-local (the
        // server runtime stamps the same field for gateway-dispatched runs).
        executionEnv: 'device' as const,
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
