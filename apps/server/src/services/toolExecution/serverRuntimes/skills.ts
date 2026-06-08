import { builtinSkills } from '@lobechat/builtin-skills';
import { LocalSystemApiName, LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
// Note: only `readFile` is wired through deviceGateway. Directory enumeration is
// left to the model via `local-system.listFiles` so we don't double-fetch.
import {
  type CommandResult,
  type ExecScriptActivatedSkill,
  SkillsIdentifier,
} from '@lobechat/builtin-tool-skills';
import {
  type DeviceFileAccess,
  type ExportFileResult,
  type SkillRuntimeService,
  SkillsExecutionRuntime,
} from '@lobechat/builtin-tool-skills/executionRuntime';
import type { BuiltinSkill, SkillItem, SkillListItem, SkillResourceContent } from '@lobechat/types';
import debug from 'debug';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { FileModel } from '@/database/models/file';
import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';
import { filterBuiltinSkills } from '@/helpers/skillFilters';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { deviceGateway } from '@/server/services/deviceGateway';
import { FileService } from '@/server/services/file';
import { MarketService } from '@/server/services/market';
import { createSandboxService, normalizeSandboxCommandResult } from '@/server/services/sandbox';
import { SkillResourceService } from '@/server/services/skill/resource';
import { preprocessLhCommand } from '@/server/services/toolExecution/preprocessLhCommand';

import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:skills-runtime');

interface UserSettingsWithMarketToken {
  market?: {
    accessToken?: string;
  };
}

class SkillServerRuntimeService implements SkillRuntimeService {
  private resourceService: SkillResourceService;
  private skillModel: AgentSkillModel;
  private marketService: MarketService;
  private fileService: FileService;
  private fileModel: FileModel;
  private serverDB: LobeChatDatabase;
  private topicId?: string;
  private userId: string;

  constructor(options: {
    fileModel: FileModel;
    fileService: FileService;
    marketService: MarketService;
    resourceService: SkillResourceService;
    serverDB: LobeChatDatabase;
    skillModel: AgentSkillModel;
    topicId?: string;
    userId: string;
  }) {
    this.skillModel = options.skillModel;
    this.resourceService = options.resourceService;
    this.marketService = options.marketService;
    this.fileService = options.fileService;
    this.fileModel = options.fileModel;
    this.serverDB = options.serverDB;
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
      const sandboxService = createSandboxService({
        fileService: this.fileService,
        marketService: this.marketService,
        serverDB: this.serverDB,
        topicId: this.topicId,
        userId: this.userId,
      });
      const response = await sandboxService.callTool('runCommand', { command: lhResult.command });

      log('runCommand response: %O', response);

      if (!response.success) {
        return {
          exitCode: 1,
          output: '',
          stderr: response.error?.message || 'Command execution failed',
          success: false,
        };
      }

      return normalizeSandboxCommandResult(response);
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
      activatedSkills?: ExecScriptActivatedSkill[];
      description: string;
    },
  ): Promise<CommandResult> => {
    const { activatedSkills, description } = options;

    if (!this.topicId) {
      throw new Error('topicId is required for execScript');
    }

    try {
      const enhancedParams: Record<string, unknown> = {
        activatedSkills,
        command,
        description,
      };

      if (activatedSkills?.length) {
        const skillZipUrls: Record<string, string> = {};

        for (const activatedSkill of activatedSkills) {
          if (!activatedSkill.name) continue;

          const skill = await this.skillModel.findByName(activatedSkill.name);

          if (!skill) {
            log('No persisted skill bundle found for activated skill: %s', activatedSkill.name);
            continue;
          }

          if (!skill.zipFileHash) continue;

          const fileInfo = await this.fileModel.checkHash(skill.zipFileHash);
          if (!fileInfo.isExist || !fileInfo.url) continue;

          const fullUrl = await this.fileService.getFullFileUrl(fileInfo.url);
          if (fullUrl) {
            skillZipUrls[skill.name] = fullUrl;
            log('Resolved zipUrl for skill %s', skill.name);
          }
        }

        if (Object.keys(skillZipUrls).length > 0) {
          enhancedParams.skillZipUrls = skillZipUrls;
          log('Added skillZipUrls to execScript params: %O', Object.keys(skillZipUrls));
        }
      }

      const sandboxService = createSandboxService({
        fileService: this.fileService,
        marketService: this.marketService,
        serverDB: this.serverDB,
        topicId: this.topicId,
        userId: this.userId,
      });
      const response = await sandboxService.callTool('execScript', enhancedParams);

      log('execScript response: %O', response);

      if (!response.success) {
        return {
          exitCode: 1,
          output: '',
          stderr: response.error?.message || 'Command execution failed',
          success: false,
        };
      }

      return normalizeSandboxCommandResult(response);
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
      const sandboxService = createSandboxService({
        fileService: this.fileService,
        marketService: this.marketService,
        topicId: this.topicId,
        userId: this.userId,
      });
      const result = await sandboxService.exportAndUploadFile(path, filename);

      return {
        fileId: result.fileId,
        filename: result.filename,
        mimeType: result.mimeType,
        size: result.size,
        success: result.success,
        url: result.url,
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
      marketAccessToken = (userSettings as UserSettingsWithMarketToken | undefined)?.market
        ?.accessToken;
      log(
        'Fetched market accessToken for user %s: %s',
        context.userId,
        marketAccessToken ? 'exists' : 'not found',
      );
    } catch (error) {
      log('Failed to fetch market accessToken for user %s: %O', context.userId, error);
    }

    const skillModel = new AgentSkillModel(context.serverDB, context.userId, context.workspaceId);
    const resourceService = new SkillResourceService(
      context.serverDB,
      context.userId,
      context.workspaceId,
    );
    const marketService = new MarketService({
      accessToken: marketAccessToken,
      userInfo: { userId: context.userId },
    });
    const fileService = new FileService(context.serverDB, context.userId, context.workspaceId);
    const fileModel = new FileModel(context.serverDB, context.userId, context.workspaceId);

    const service = new SkillServerRuntimeService({
      fileModel,
      fileService,
      marketService,
      resourceService,
      serverDB: context.serverDB,
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
      ? await new AgentDocumentsService(context.serverDB, context.userId, context.workspaceId)
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
    // file-read primitive, just the existing capabilities over deviceGateway.
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
          const result = await deviceGateway.executeToolCall(
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
          const result = await deviceGateway.executeToolCall(
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
