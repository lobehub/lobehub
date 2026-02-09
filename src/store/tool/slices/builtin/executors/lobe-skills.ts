/**
 * Lobe Skills Executor
 *
 * Creates and exports the SkillsExecutor instance for registration.
 * Injects agentSkillService as dependency.
 */
import { builtinSkills } from '@lobechat/builtin-skills';
import { SkillsExecutionRuntime } from '@lobechat/builtin-tool-skills/executionRuntime';
import { SkillsExecutor } from '@lobechat/builtin-tool-skills/executor';
import { isDesktop } from '@lobechat/const';

import { cloudSandboxService } from '@/services/cloudSandbox';
import { localFileService } from '@/services/electron/localFileService';
import { agentSkillService } from '@/services/skill';
import { useChatStore } from '@/store/chat';

// Create runtime with client-side service
const runtime = new SkillsExecutionRuntime({
  builtinSkills,
  service: {
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
      } catch (error) {
        return {
          filename,
          success: false,
        };
      }
    },
    execScript: async (command, options) => {
      const { runInClient, description, config } = options;

      // Desktop: run in local client if requested
      if (isDesktop && runInClient) {
        const result = await localFileService.runCommand({ command, timeout: undefined });
        return {
          exitCode: result.exit_code ?? 1,
          output: result.stdout || result.output || '',
          stderr: result.stderr,
          success: result.success,
        };
      }

      // Cloud: execute via Cloud Sandbox with execScript tool
      // Server will automatically resolve zipUrl based on config.name
      const chatState = useChatStore.getState();
      const topicId = chatState.activeTopicId || 'default';

      try {
        // Call cloud sandbox execScript tool
        const result = await cloudSandboxService.callTool(
          'execScript',
          {
            command,
            config,
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
          success: result.success && (sandboxResult.exitCode === 0 || sandboxResult.exitCode === undefined),
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
    findAll: () => agentSkillService.list(),
    findById: (id) => agentSkillService.getById(id),
    findByName: (name) => agentSkillService.getByName(name),
    importFromGitHub: async (gitUrl) => {
      const result = await agentSkillService.importFromGitHub({ gitUrl });
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
    readResource: (id, path) => agentSkillService.readResource(id, path),
    runCommand: async ({ command, runInClient, timeout }) => {
      // Desktop: run in local client if requested
      if (isDesktop && runInClient) {
        const result = await localFileService.runCommand({ command, timeout });
        return {
          exitCode: result.exit_code ?? 1,
          output: result.stdout || result.output || '',
          stderr: result.stderr,
          success: result.success,
        };
      }

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
            description: `Execute skill command: ${command.substring(0, 100)}${command.length > 100 ? '...' : ''}`,
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
          success: result.success && (sandboxResult.exitCode === 0 || sandboxResult.exitCode === undefined),
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
