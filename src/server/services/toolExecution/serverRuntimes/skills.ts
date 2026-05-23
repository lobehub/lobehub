import { builtinSkills } from '@lobechat/builtin-skills';
import { LocalSystemApiName, LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
// Note: only `readFile` is wired through deviceProxy. Directory enumeration is
// left to the model via `local-system.listFiles` so we don't double-fetch.
import { type CommandResult, SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import {
  type DeviceFileAccess,
  type ExportFileResult,
  type SkillRuntimeService,
  SkillsExecutionRuntime,
} from '@lobechat/builtin-tool-skills/executionRuntime';
import type { BuiltinSkill, SkillItem, SkillListItem, SkillResourceContent } from '@lobechat/types';
import type { CodeInterpreterToolName } from '@lobehub/market-sdk';
import debug from 'debug';
import { sha256 } from 'js-sha256';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { FileModel } from '@/database/models/file';
import { UserModel } from '@/database/models/user';
import { filterBuiltinSkills } from '@/helpers/skillFilters';
import { FileS3 } from '@/server/modules/S3';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import { SkillResourceService } from '@/server/services/skill/resource';
import { preprocessLhCommand } from '@/server/services/toolExecution/preprocessLhCommand';

import { deviceProxy } from '../deviceProxy';
import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:skills-runtime');

class SkillServerRuntimeService implements SkillRuntimeService {
  private resourceService: SkillResourceService;
  private skillModel: AgentSkillModel;
  private marketService: MarketService;
  private fileService: FileService;
  private fileModel: FileModel;
  private topicId?: string;
  private userId: string;

  constructor(options: {
    fileModel: FileModel;
    fileService: FileService;
    marketService: MarketService;
    resourceService: SkillResourceService;
    skillModel: AgentSkillModel;
    topicId?: string;
    userId: string;
  }) {
    this.skillModel = options.skillModel;
    this.resourceService = options.resourceService;
    this.marketService = options.marketService;
    this.fileService = options.fileService;
    this.fileModel = options.fileModel;
    this.topicId = options.topicId;
    this.userId = options.userId;
  }

  findAll = (): Promise<{ data: SkillListItem[]; total: number }> => {
    return this.skillModel.findAll();
  };

  findById = (id: string): Promise<SkillItem | undefined> => {
    return this.skillModel.findById(id);
  };

  findByName = (name: string): Promise<SkillItem | undefined> => {
    return this.skillModel.findByName(name);
  };

  readResource = async (id: string, path: string): Promise<SkillResourceContent> => {
    const skill = await this.skillModel.findById(id);
    if (!skill) throw new Error(`Skill not found: ${id}`);
    if (!skill.resources) throw new Error(`Skill has no resources: ${id}`);
    return this.resourceService.readResource(skill.resources, path);
  };

  runCommand = async (options: { command: string }): Promise<CommandResult> => {
    if (!this.topicId) {
      throw new Error('topicId is required for runCommand');
    }

    // Preprocess lh commands: rewrite to npx @lobehub/cli + inject auth env vars
    const lhResult = await preprocessLhCommand(options.command, this.userId);
    if (lhResult.error) {
      return { exitCode: 1, output: '', stderr: lhResult.error, success: false };
    }

    try {
      const market = this.marketService.market;
      const response = await market.plugins.runBuildInTool(
        'runCommand' as any,
        { command: lhResult.command },
        { topicId: this.topicId, userId: this.userId },
      );

      log('runCommand response: %O', response);

      if (!response.success) {
        return {
          exitCode: 1,
          output: '',
          stderr: response.error?.message || 'Command execution failed',
          success: false,
        };
      }

      const result = response.data?.result || {};

      return {
        exitCode: result.exitCode ?? (response.success ? 0 : 1),
        output: result.stdout || result.output || '',
        stderr: result.stderr || '',
        success: response.success && (result.exitCode === 0 || result.exitCode === undefined),
      };
    } catch (error) {
      log('Error running command: %O', error);
      return {
        exitCode: 1,
        output: '',
        stderr: (error as Error).message || 'Command execution failed',
        success: false,
      };
    }
  };

  execScript = async (
    command: string,
    options: {
      config?: { description?: string; id?: string; name?: string };
      description: string;
      runInClient?: boolean;
    },
  ): Promise<CommandResult> => {
    const { config, description } = options;

    if (!this.topicId) {
      throw new Error('topicId is required for execScript');
    }

    try {
      // Look up skill zipUrl if config is provided (same logic as market.ts)
      const enhancedParams: any = {
        command,
        config,
        description,
      };

      if (config?.name) {
        const skill = await this.skillModel.findByName(config.name);

        // If skill not found, return error with available skills
        if (!skill) {
          const allSkills = await this.skillModel.findAll();
          const availableSkills = allSkills.data.map((s) => s.name).join(', ');

          const errorMessage = availableSkills
            ? `Skill "${config.name}" not found. Available skills: ${availableSkills}`
            : `Skill "${config.name}" not found. No skills available. Please import a skill first.`;

          log('Skill not found: %s. Available skills: %s', config.name, availableSkills);

          return {
            exitCode: 1,
            output: '',
            stderr: errorMessage,
            success: false,
          };
        }

        if (skill.zipFileHash) {
          // Get S3 key from globalFiles
          const fileInfo = await this.fileModel.checkHash(skill.zipFileHash);

          if (fileInfo.isExist && fileInfo.url) {
            // Convert S3 key to full URL
            const fullUrl = await this.fileService.getFullFileUrl(fileInfo.url);
            if (fullUrl) {
              enhancedParams.zipUrl = fullUrl;
              log('Added zipUrl to execScript params for skill %s: %s', skill.name, fullUrl);
            }
          }
        }
      }

      // Call market-sdk's runBuildInTool
      const market = this.marketService.market;
      const response = await market.plugins.runBuildInTool(
        'execScript' as CodeInterpreterToolName,
        enhancedParams,
        { topicId: this.topicId, userId: this.userId },
      );

      log('execScript response: %O', response);

      if (!response.success) {
        return {
          exitCode: 1,
          output: '',
          stderr: response.error?.message || 'Command execution failed',
          success: false,
        };
      }

      const result = response.data?.result || {};

      return {
        exitCode: result.exitCode ?? (response.success ? 0 : 1),
        output: result.stdout || result.output || '',
        stderr: result.stderr || '',
        success: response.success && (result.exitCode === 0 || result.exitCode === undefined),
      };
    } catch (error) {
      log('Error executing script: %O', error);
      return {
        exitCode: 1,
        output: '',
        stderr: (error as Error).message || 'Command execution failed',
        success: false,
      };
    }
  };

  exportFile = async (path: string, filename: string): Promise<ExportFileResult> => {
    if (!this.topicId) {
      throw new Error('topicId is required for exportFile');
    }

    try {
      const s3 = new FileS3();

      // Use date-based sharding (same as market.ts)
      const today = new Date().toISOString().split('T')[0];
      const key = `code-interpreter-exports/${today}/${this.topicId}/${filename}`;

      // Step 1: Generate pre-signed upload URL
      const uploadUrl = await s3.createPreSignedUrl(key);
      log('Generated upload URL for key: %s', key);

      // Step 2: Call sandbox's exportFile tool with the upload URL
      const market = this.marketService.market;
      const response = await market.plugins.runBuildInTool(
        'exportFile' as CodeInterpreterToolName,
        { path, uploadUrl },
        { topicId: this.topicId, userId: this.userId },
      );

      log('Sandbox exportFile response: %O', response);

      if (!response.success) {
        return {
          filename,
          success: false,
        };
      }

      const result = response.data?.result;
      const uploadSuccess = result?.success !== false;

      if (!uploadSuccess) {
        return {
          filename,
          success: false,
        };
      }

      // Step 3: Get file metadata from S3
      const metadata = await s3.getFileMetadata(key);
      const fileSize = metadata.contentLength;
      const mimeType = metadata.contentType || result?.mimeType || 'application/octet-stream';

      // Step 4: Create persistent file record
      const fileHash = sha256(key + Date.now().toString());

      const { fileId, url } = await this.fileService.createFileRecord({
        fileHash,
        fileType: mimeType,
        name: filename,
        size: fileSize,
        url: key, // Store S3 key
      });

      log('Created file record: fileId=%s, url=%s', fileId, url);

      return {
        fileId,
        filename,
        mimeType,
        size: fileSize,
        success: true,
        url, // This is the permanent /f:id URL
      };
    } catch (error) {
      log('Error exporting file: %O', error);
      return {
        filename,
        success: false,
      };
    }
  };
}

/**
 * Skills Server Runtime
 * Per-request runtime (needs serverDB, userId, topicId)
 */
export const skillsRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for Skills execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for Skills execution');
    }

    // Fetch market access token from user settings
    let marketAccessToken: string | undefined;
    try {
      const userModel = new UserModel(context.serverDB, context.userId);
      const userSettings = await userModel.getUserSettings();
      marketAccessToken = (userSettings?.market as any)?.accessToken;
      log(
        'Fetched market accessToken for user %s: %s',
        context.userId,
        marketAccessToken ? 'exists' : 'not found',
      );
    } catch (error) {
      log('Failed to fetch market accessToken for user %s: %O', context.userId, error);
    }

    const skillModel = new AgentSkillModel(context.serverDB, context.userId);
    const resourceService = new SkillResourceService(context.serverDB, context.userId);
    const marketService = new MarketService({
      accessToken: marketAccessToken,
      userInfo: { userId: context.userId },
    });
    const fileService = new FileService(context.serverDB, context.userId);
    const fileModel = new FileModel(context.serverDB, context.userId);

    const service = new SkillServerRuntimeService({
      fileModel,
      fileService,
      marketService,
      resourceService,
      skillModel,
      topicId: context.topicId,
      userId: context.userId,
    });

    // Surface this agent's skill-bundle documents as `BuiltinSkill`-shaped
    // entries so `activateSkill('agent-skills:<filename>')` resolves on the
    // existing no-DB-lookup path — no `SkillRuntimeService` extension needed.
    // `AgentDocumentsService.getAgentSkills` is the single source of truth for
    // the identifier prefix and the bundle → index-child content resolution
    // (also used by `aiAgent/index.ts` when building `<available_skills>`).
    // `source: 'builtin'` is the type-system carrier shape required by
    // `BuiltinSkill`; the runtime re-tags `source: 'agent'` in the activateSkill
    // result based on the identifier prefix so the inspector can show
    // "Activate Agent Skill" + the friendly `title`.
    const agentSkillBuiltins: BuiltinSkill[] = context.agentId
      ? await new AgentDocumentsService(context.serverDB, context.userId)
          .getAgentSkills(context.agentId)
          .then((skills) =>
            skills.map((skill) => ({
              content: skill.content,
              description: skill.description,
              identifier: skill.identifier,
              name: skill.name,
              source: 'builtin' as const,
              ...(skill.title && { title: skill.title }),
            })),
          )
          .catch((error) => {
            log('failed to load agent skills for agent %s: %O', context.agentId, error);
            return [];
          })
      : [];

    // Project skills live on the device filesystem. Read them through the
    // device gateway by reusing the local-system tools — no special
    // file-read primitive, just the existing capabilities over deviceProxy.
    //   - `readFile`  loads SKILL.md and validated reference files.
    //   - `globFiles` enumerates the skill directory so `readReference` can
    //     reject paths the model guessed (e.g. `.env`) instead of trusting
    //     the raw string. The discovery payload no longer carries the file
    //     tree (see commit 8e8f3aed14), so we enumerate live at read time.
    const { activeDeviceId, projectSkills } = context;
    let deviceFileAccess: DeviceFileAccess | undefined;
    if (activeDeviceId && context.userId) {
      const userId = context.userId;
      deviceFileAccess = {
        listFiles: async (dir: string) => {
          const result = await deviceProxy.executeToolCall(
            { deviceId: activeDeviceId, userId },
            {
              apiName: LocalSystemApiName.globFiles,
              // `**/*` matches every regular file recursively under `dir`.
              // The device-side enumerator already skips hidden files; the
              // runtime re-checks segments as defense in depth.
              arguments: JSON.stringify({ pattern: '**/*', scope: dir }),
              identifier: LocalSystemIdentifier,
            },
          );
          if (!result.success) {
            throw new Error(result.error || result.content || `globFiles failed: ${dir}`);
          }
          let payload: { files?: unknown };
          try {
            payload = JSON.parse(result.content) as { files?: unknown };
          } catch {
            throw new Error(`globFiles returned a non-JSON payload for ${dir}`);
          }
          if (!Array.isArray(payload.files)) return [];
          // Files come back as paths relative to `scope` (POSIX). Strip any
          // absolute path the engine may have emitted so the runtime can
          // compare against normalized user-supplied relative paths.
          return payload.files
            .filter((f): f is string => typeof f === 'string')
            .map((f) => (f.startsWith(dir) ? f.slice(dir.length).replace(/^[/\\]+/, '') : f));
        },
        readFile: async (filePath: string) => {
          const result = await deviceProxy.executeToolCall(
            { deviceId: activeDeviceId, userId },
            {
              apiName: LocalSystemApiName.readFile,
              // Read the whole file; SKILL.md and references are small.
              arguments: JSON.stringify({ loc: [0, 5000], path: filePath }),
              identifier: LocalSystemIdentifier,
            },
          );
          if (!result.success) {
            throw new Error(result.error || result.content || `readFile failed: ${filePath}`);
          }
          return result.content;
        },
      };
    }

    return new SkillsExecutionRuntime({
      builtinSkills: [...filterBuiltinSkills(builtinSkills), ...agentSkillBuiltins],
      deviceFileAccess,
      projectSkills,
      service,
    });
  },
  identifier: SkillsIdentifier,
};
