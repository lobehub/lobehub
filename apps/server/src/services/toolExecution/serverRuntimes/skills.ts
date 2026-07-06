import { builtinSkills } from '@lobechat/builtin-skills';
import { LocalSystemApiName, LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
// Note: only `readFile` is wired through deviceGateway. Directory enumeration is
// left to the model via `local-system.globFiles` so we don't double-fetch.
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

import { resolveRunWorkspaceId } from './resolveWorkspaceScope';
import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:skills-runtime');

interface UserSettingsWithMarketToken {
  market?: {
    accessToken?: string;
  };
}

/**
 * Device-execution wiring for the exec APIs, present only when the run's
 * execution plan routed a device (`plan.kind === 'device'` — the aiAgent sets
 * `context.activeDeviceId` from exactly that condition). When present,
 * `execScript` runs ON the device instead of the cloud sandbox: skill archives
 * are prepared device-side via the `prepareSkillDirectory` RPC and the command
 * executes through the local-system tool over the device gateway.
 */
interface SkillDeviceExecution {
  deviceId: string;
  executionTimeoutMs?: number;
  operationId?: string;
  /** Lazily resolved workspace principal — see `resolveRunWorkspaceId`. */
  resolveWorkspaceId: () => Promise<string | undefined>;
  /** cwd fallback when no activated skill ships an archive. */
  workingDirectory?: string;
}

interface ActivatedSkillArchive {
  name: string;
  url: string;
  zipHash: string;
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
  private device?: SkillDeviceExecution;

  constructor(options: {
    device?: SkillDeviceExecution;
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
    this.device = options.device;
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
      return {
        executionEnv: 'sandbox',
        exitCode: 1,
        output: '',
        stderr: lhResult.error,
        success: false,
      };
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
          executionEnv: 'sandbox',
          exitCode: 1,
          output: '',
          stderr: response.error?.message || 'Command execution failed',
          success: false,
        };
      }

      return { ...normalizeSandboxCommandResult(response), executionEnv: 'sandbox' };
    } catch (error) {
      log('Error running command: %O', error);
      return {
        executionEnv: 'sandbox',
        exitCode: 1,
        output: '',
        stderr: (error as Error).message || 'Command execution failed',
        success: false,
      };
    }
  };

  /**
   * Resolve the presigned zip URLs (+ content hashes) of the activated skills
   * that have a persisted archive, preserving activation order. Shared by the
   * sandbox path (needs name → url) and the device path (needs the zipHash as
   * the device-cache idempotency key).
   */
  private resolveActivatedSkillArchives = async (
    activatedSkills?: ExecScriptActivatedSkill[],
  ): Promise<ActivatedSkillArchive[]> => {
    const archives: ActivatedSkillArchive[] = [];
    if (!activatedSkills?.length) return archives;

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
        archives.push({ name: skill.name, url: fullUrl, zipHash: skill.zipFileHash });
        log('Resolved zipUrl for skill %s', skill.name);
      }
    }

    return archives;
  };

  /**
   * Run execScript ON the routed device: prepare every activated skill archive
   * device-side (idempotent by zipHash), then execute the command through the
   * local-system tool over the device gateway with cwd = the extracted skill
   * directory.
   *
   * Failures return an explicit error and NEVER fall back to the sandbox — a
   * silent sandbox run against a user who chose their device is exactly the
   * regression this path fixes. Typical failure: an older desktop build that
   * doesn't know the `prepareSkillDirectory` RPC yet.
   */
  private execScriptOnDevice = async (
    command: string,
    activatedSkills?: ExecScriptActivatedSkill[],
  ): Promise<CommandResult> => {
    const device = this.device!;
    const fail = (stderr: string): CommandResult => ({
      executionEnv: 'device',
      exitCode: 1,
      output: '',
      stderr,
      success: false,
    });

    try {
      const archives = await this.resolveActivatedSkillArchives(activatedSkills);
      const workspaceId = await device.resolveWorkspaceId();

      // Prepare all activated archives; the LAST one (most recently activated)
      // wins as cwd — mirrors the sandbox provider's resolveExecScriptSkillName.
      let runDir: string | undefined;
      for (const archive of archives) {
        const prepared = await deviceGateway.prepareSkillDirectory({
          deviceId: device.deviceId,
          url: archive.url,
          userId: this.userId,
          workspaceId,
          zipHash: archive.zipHash,
        });

        if (!prepared.success || !prepared.extractedDir) {
          return fail(
            `Failed to prepare skill "${archive.name}" on the user's device: ${prepared.error ?? 'unknown error'}. ` +
              'Do not retry elsewhere — report this to the user (their LobeHub app may need an update).',
          );
        }
        runDir = prepared.extractedDir;
      }

      const cwd = runDir ?? device.workingDirectory;
      const response = await deviceGateway.executeToolCall(
        {
          deviceId: device.deviceId,
          operationId: device.operationId,
          userId: this.userId,
          workspaceId,
        },
        {
          apiName: LocalSystemApiName.runCommand,
          arguments: JSON.stringify({ command, ...(cwd && { cwd }) }),
          identifier: LocalSystemIdentifier,
        },
        device.executionTimeoutMs,
      );

      log('execScript device response: %O', response);

      const state = (response.state ?? {}) as {
        exitCode?: number;
        stderr?: string;
        stdout?: string;
      };

      if (!response.success) {
        return fail(
          state.stderr ||
            response.error ||
            response.content ||
            'Command execution failed on the device',
        );
      }

      return {
        executionEnv: 'device',
        exitCode: state.exitCode ?? 0,
        output: state.stdout ?? response.content ?? '',
        stderr: state.stderr,
        success: true,
      };
    } catch (error) {
      log('Error executing script on device: %O', error);
      return fail((error as Error).message || 'Command execution failed on the device');
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

    // Execution target follows the run's plan: a routed device wins over the
    // sandbox (restores the pre-gateway desktop behavior).
    if (this.device) {
      return this.execScriptOnDevice(command, activatedSkills);
    }

    if (!this.topicId) {
      throw new Error('topicId is required for execScript');
    }

    try {
      const enhancedParams: Record<string, unknown> = {
        activatedSkills,
        command,
        description,
      };

      const archives = await this.resolveActivatedSkillArchives(activatedSkills);
      if (archives.length > 0) {
        enhancedParams.skillZipUrls = Object.fromEntries(archives.map((a) => [a.name, a.url]));
        log(
          'Added skillZipUrls to execScript params: %O',
          archives.map((a) => a.name),
        );
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
          executionEnv: 'sandbox',
          exitCode: 1,
          output: '',
          stderr: response.error?.message || 'Command execution failed',
          success: false,
        };
      }

      return { ...normalizeSandboxCommandResult(response), executionEnv: 'sandbox' };
    } catch (error) {
      log('Error executing script: %O', error);
      return {
        executionEnv: 'sandbox',
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

    // `activeDeviceId` is set by the aiAgent ONLY when the execution plan
    // routed a device (`plan.kind === 'device'`), so its presence is the
    // device-branch switch: execScript then runs on the device instead of the
    // cloud sandbox. `device-unrouted` runs carry no activeDeviceId and keep
    // the sandbox path (with the unrouted disclosure in the manifest).
    let workspaceIdPromise: Promise<string | undefined> | undefined;
    const device: SkillDeviceExecution | undefined = context.activeDeviceId
      ? {
          deviceId: context.activeDeviceId,
          executionTimeoutMs: context.executionTimeoutMs,
          operationId: context.operationId,
          // Same lazy workspace-principal recovery as the local-system runtime,
          // so workspace devices are addressed under the right gateway pool.
          resolveWorkspaceId: () => (workspaceIdPromise ??= resolveRunWorkspaceId(context)),
          workingDirectory: context.workingDirectory,
        }
      : undefined;

    const service = new SkillServerRuntimeService({
      device,
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

    // Project/device skills live on the execution device filesystem. Read them through the
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
      builtinSkills: [
        // Device-only skills resolve in device-capable runs — mirrors the
        // SkillEngine gate in aiAgent that builds <available_skills>, so a
        // `device-unrouted` run can activate/read them before the model routes
        // a device. `activeDeviceId` is the fallback for callers without an
        // execution plan.
        ...filterBuiltinSkills(builtinSkills, {
          canExecuteOnDevice: context.deviceCapable ?? !!activeDeviceId,
        }),
        ...agentSkillBuiltins,
      ],
      deviceFileAccess,
      projectSkills,
      service,
    });
  },
  identifier: SkillsIdentifier,
};
