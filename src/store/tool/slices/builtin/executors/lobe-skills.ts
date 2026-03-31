/**
 * Lobe Skills Executor
 *
 * Creates and exports the SkillsExecutor instance for registration.
 * Injects agentSkillService as dependency.
 */
import { builtinSkills } from '@lobechat/builtin-skills';
import { SkillsExecutionRuntime } from '@lobechat/builtin-tool-skills/executionRuntime';
import { SkillsExecutor } from '@lobechat/builtin-tool-skills/executor';

import { filterBuiltinSkills } from '@/helpers/skillFilters';
import { cloudSandboxService } from '@/services/cloudSandbox';
import { agentSkillService } from '@/services/skill';
import { useChatStore } from '@/store/chat';

// Create runtime with client-side service
const runtime = new SkillsExecutionRuntime({
  builtinSkills: filterBuiltinSkills(builtinSkills),
  service: {
    execScript: async (command, options) => {
      const { activatedSkills, description } = options;

      // Cloud: execute via Cloud Sandbox with execScript tool
      // Server will resolve zipUrls for all activatedSkills
      const chatState = useChatStore.getState();
      const topicId = chatState.activeTopicId || 'default';

      try {
        // Call cloud sandbox execScript tool
        const result = await cloudSandboxService.callTool(
          'execScript',
          {
            activatedSkills,
            command,
            description,
          },
          { topicId },
        );

        if (!result.success) {
          return {
            exitCode: 1,
            output: '',
            stderr: result.error?.message || 'Command execution failed',
            success: false,
          };
        }

        const sandboxResult = result.result || {};

        return {
          exitCode: sandboxResult.exitCode ?? (result.success ? 0 : 1),
          output: sandboxResult.stdout || sandboxResult.output || '',
          stderr: sandboxResult.stderr || '',
          success:
            result.success &&
            (sandboxResult.exitCode === 0 || sandboxResult.exitCode === undefined),
        };
      } catch (error) {
        return {
          exitCode: 1,
          output: '',
          stderr: (error as Error).message || 'Command execution failed',
          success: false,
        };
      }
    },
    exportFile: async (path, filename) => {
      // Get current session context
      const chatState = useChatStore.getState();
      const topicId = chatState.activeTopicId || 'default';

      try {
        // Call cloud sandbox exportAndUploadFile
        const result = await cloudSandboxService.exportAndUploadFile(path, filename, topicId);

        return {
          fileId: result.fileId,
          filename: result.filename,
          mimeType: result.mimeType,
          size: result.size,
          success: result.success,
          url: result.url,
        };
      } catch {
        return {
          filename,
          success: false,
        };
      }
    },
    findAll: () => agentSkillService.list(),
    findById: (id) => agentSkillService.getById(id),
    findByName: (name) => agentSkillService.getByName(name),
    readResource: (id, path) => agentSkillService.readResource(id, path),
    runCommand: async ({ command, timeout }) => {
      // Cloud: execute via Cloud Sandbox
      // Get current session context for sandbox isolation
      const chatState = useChatStore.getState();
      const topicId = chatState.activeTopicId || 'default';

      try {
        // Call cloud sandbox via TRPC
        // Note: userId is automatically set by server from authenticated context
        const result = await cloudSandboxService.callTool(
          'runCommand',
          {
            command,
            description: `Execute skill command: ${command.slice(0, 100)}${command.length > 100 ? '...' : ''}`,
            timeout,
          },
          { topicId },
        );

        if (!result.success) {
          return {
            exitCode: 1,
            output: '',
            stderr: result.error?.message || 'Command execution failed',
            success: false,
          };
        }

        // Parse cloud sandbox result
        const sandboxResult = result.result || {};

        return {
          exitCode: sandboxResult.exitCode ?? (result.success ? 0 : 1),
          output: sandboxResult.stdout || sandboxResult.output || '',
          stderr: sandboxResult.stderr || '',
          success:
            result.success &&
            (sandboxResult.exitCode === 0 || sandboxResult.exitCode === undefined),
        };
      } catch (error) {
        return {
          exitCode: 1,
          output: '',
          stderr: (error as Error).message || 'Command execution failed',
          success: false,
        };
      }
    },
  },
});

// Create executor instance with the runtime
export const skillsExecutor = new SkillsExecutor(runtime);
