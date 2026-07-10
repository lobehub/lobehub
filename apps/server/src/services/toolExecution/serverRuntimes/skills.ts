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
  getDirname,
  type SkillRuntimeService,
  SkillsExecutionRuntime,
} from '@lobechat/builtin-tool-skills/executionRuntime';
import {
  type BuiltinSkill,
  getDisabledPluginIds,
  type SkillItem,
  type SkillListItem,
  type SkillResourceContent,
} from '@lobechat/types';
import debug from 'debug';

import { AgentModel } from '@/database/models/agent';
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
  /**
   * Filesystem skills already living on the device (project/device SKILL.md).
   * execScript resolves their SKILL.md directory as cwd, mirroring the
   * prepared-archive skills.
   */
  projectSkills?: { location: string; name: string }[];
  /** Lazily resolved workspace principal — see `resolveRunWorkspaceId`. */
  resolveWorkspaceId: () => Promise<string | undefined>;
  /** cwd fallback when no activated skill resolves to a directory. */
  workingDirectory?: string;
}

interface ActivatedSkillArchive {
  name: string;
  url: string;
  zipHash: string;
}

/**
 * Sentinel returned by `execScriptOnDevice` when the routed device runs a
 * client build that predates the `prepareSkillDirectory` RPC (shipped with
 * this feature). The device dispatcher replies deterministically with an
 * unknown-method error, so this is a reliable capability probe — distinct
 * from network failures/timeouts, which must NOT trigger a fallback.
 */
const LEGACY_DEVICE_CLIENT = Symbol('legacy-device-client');

/**
 * Appended to the sandbox result on a legacy-client fallback so the model
 * discloses the degradation — the manifest already told it the command would
 * run on the user's device.
 */
const LEGACY_FALLBACK_NOTE =
  "Note: the user's device client is outdated and does not support on-device skill execution, so this command ran in the cloud sandbox instead. Tell the user to update their LobeHub app to run skills on their device.";

const LH_COMMAND_PATTERN = /(?:^|&&|\|\||;)\s*lh(?:\s|$)/;

const isLhCommand = (command: string) => LH_COMMAND_PATTERN.test(command);

class SkillServerRuntimeService implements SkillRuntimeService {
  private agentId?: string;
  private resourceService: SkillResourceService;
  private skillModel: AgentSkillModel;
  private marketService: MarketService;
  private fileService: FileService;
  private fileModel: FileModel;
  private serverDB: LobeChatDatabase;
  private topicId?: string;
  private userId: string;
  private workspaceId?: string;
  private device?: SkillDeviceExecution;
  private disabledSkillIds: Set<string>;

  constructor(options: {
    agentId?: string;
    device?: SkillDeviceExecution;
    /**
     * Identifiers the agent has explicitly disabled (`agents.plugins` tri-state)
     * — findById/findByName resolve to `undefined` for these, so a disabled
     * DB/market skill can't be activated even by a model that already knows
     * its name, independent of whatever's listed in `<available_skills>`.
     */
    disabledSkillIds?: Set<string>;
    fileModel: FileModel;
    fileService: FileService;
    marketService: MarketService;
    resourceService: SkillResourceService;
    serverDB: LobeChatDatabase;
    skillModel: AgentSkillModel;
    topicId?: string;
    userId: string;
    workspaceId?: string;
  }) {
    this.agentId = options.agentId;
    this.skillModel = options.skillModel;
    this.resourceService = options.resourceService;
    this.marketService = options.marketService;
    this.fileService = options.fileService;
    this.fileModel = options.fileModel;
    this.serverDB = options.serverDB;
    this.topicId = options.topicId;
    this.userId = options.userId;
    this.workspaceId = options.workspaceId;
    this.device = options.device;
    this.disabledSkillIds = options.disabledSkillIds ?? new Set();
  }

  findAll = (): Promise<{ data: SkillListItem[]; total: number }> => {
    return this.skillModel.findAll();
  };

  findById = async (id: string): Promise<SkillItem | undefined> => {
    const skill = await this.skillModel.findById(id);
    return skill && this.disabledSkillIds.has(skill.identifier) ? undefined : skill;
  };

  findByName = async (name: string): Promise<SkillItem | undefined> => {
    const skill = await this.skillModel.findByName(name);
    return skill && this.disabledSkillIds.has(skill.identifier) ? undefined : skill;
  };

  private resolveWorkspaceId = async (): Promise<string | undefined> => {
    return resolveRunWorkspaceId({
      agentId: this.agentId,
      serverDB: this.serverDB,
      workspaceId: this.workspaceId,
    });
  };

  readResource = async (id: string, path: string): Promise<SkillResourceContent> => {
    const skill = await this.skillModel.findById(id);
    if (!skill) throw new Error(`Skill not found: ${id}`);
    if (!skill.resources) throw new Error(`Skill has no resources: ${id}`);
    return this.resourceService.readResource(skill.resources, path);
  };

  runCommand = async (options: { command: string }): Promise<CommandResult> => {
    // The device manifest hides this sandbox API (`DEVICE_HIDDEN_API_NAMES` in
    // `resolveManifest`), but the builtin executor dispatches any method that
    // exists on this runtime regardless of the manifest — enforce the same
    // decision at execution time so a prompt-following or hallucinated call
    // can't silently run in the sandbox while the user expects their device.
    if (this.device) {
      return {
        exitCode: 1,
        output: '',
        stderr:
          'runCommand targets the cloud sandbox and is unavailable while a local device is routed. Use execScript for skill scripts, or lobe-local-system runCommand for other shell commands on the device.',
        success: false,
      };
    }

    if (!this.topicId) {
      throw new Error('topicId is required for runCommand');
    }

    // Preprocess lh commands: rewrite to npx @lobehub/cli + inject auth env vars
    const workspaceId =
      this.workspaceId ??
      (isLhCommand(options.command) ? await this.resolveWorkspaceId() : undefined);
    const lhResult = await preprocessLhCommand(options.command, this.userId, workspaceId);
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
   * regression this path fixes. Single exception: an older client build that
   * doesn't know the `prepareSkillDirectory` RPC yet (version-skew window)
   * returns the `LEGACY_DEVICE_CLIENT` sentinel, and the caller runs the
   * sandbox path with an explicit disclosure note instead.
   */
  private execScriptOnDevice = async (
    command: string,
    activatedSkills?: ExecScriptActivatedSkill[],
  ): Promise<CommandResult | typeof LEGACY_DEVICE_CLIENT> => {
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
      const archiveByName = new Map(archives.map((a) => [a.name.toLowerCase(), a]));
      const workspaceId = await device.resolveWorkspaceId();

      // Resolve each activated skill to a device directory in activation
      // order; the LAST resolvable one wins as cwd — mirrors the sandbox
      // provider's resolveExecScriptSkillName. Filesystem (project/device)
      // skills already live on the device, so their SKILL.md directory is the
      // cwd directly; archive-backed skills are prepared device-side first
      // (idempotent by zipHash).
      //
      // Prepares fire concurrently (deduped by zipHash — concurrent extraction
      // of the same archive would also race device-side): each call is a full
      // device-gateway round-trip and activatedSkills accumulates over the
      // conversation, so awaiting one by one scales exec latency linearly with
      // skill count. The walk below consumes the settled results in activation
      // order, preserving the sequential semantics: last resolvable wins, and
      // the FIRST failure in activation order is the one reported (including
      // the legacy-client sentinel).
      const isProjectSkill = (lowerName: string) =>
        device.projectSkills?.some((s) => s.name.toLowerCase() === lowerName);
      const prepareByHash = new Map<
        string,
        ReturnType<typeof deviceGateway.prepareSkillDirectory>
      >();
      for (const activated of activatedSkills ?? []) {
        const lowerName = activated.name?.toLowerCase();
        if (!lowerName || isProjectSkill(lowerName)) continue;
        const archive = archiveByName.get(lowerName);
        if (!archive || prepareByHash.has(archive.zipHash)) continue;
        prepareByHash.set(
          archive.zipHash,
          deviceGateway.prepareSkillDirectory({
            deviceId: device.deviceId,
            url: archive.url,
            userId: this.userId,
            workspaceId,
            zipHash: archive.zipHash,
          }),
        );
      }
      // Settle everything up front so the early return on a first failure
      // below can't leave a later rejection unhandled (prepareSkillDirectory
      // reports failures as `success: false` rather than throwing, so this is
      // belt-and-braces; re-awaiting a settled entry in the walk is free).
      await Promise.allSettled(prepareByHash.values());

      let runDir: string | undefined;
      for (const activated of activatedSkills ?? []) {
        if (!activated.name) continue;
        const lowerName = activated.name.toLowerCase();

        // Filesystem skills take precedence on name collision, matching
        // `activateSkill` in the ExecutionRuntime.
        const projectSkill = device.projectSkills?.find((s) => s.name.toLowerCase() === lowerName);
        if (projectSkill) {
          runDir = getDirname(projectSkill.location) || runDir;
          continue;
        }

        const archive = archiveByName.get(lowerName);
        if (!archive) continue;

        const prepared = await prepareByHash.get(archive.zipHash)!;

        if (!prepared.success || !prepared.extractedDir) {
          // The device dispatcher's deterministic reply for a method it does
          // not know — the client predates this RPC, hand back to the caller
          // for the sandbox fallback.
          if (prepared.error?.includes('Unknown device RPC method')) {
            log('Device %s predates prepareSkillDirectory, falling back', device.deviceId);
            return LEGACY_DEVICE_CLIENT;
          }

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
          // `timeout` is the device-side shell observation window (default
          // 30s, clamped at the device's MAX_OBSERVATION_TIMEOUT_MS) — without
          // it a long script returns early while still running.
          arguments: JSON.stringify({
            command,
            ...(cwd && { cwd }),
            ...(device.executionTimeoutMs && { timeout: device.executionTimeoutMs }),
          }),
          identifier: LocalSystemIdentifier,
        },
        device.executionTimeoutMs,
      );

      log('execScript device response: %O', response);

      const state = (response.state ?? {}) as {
        commandId?: string;
        error?: string;
        exitCode?: number;
        outputFiles?: CommandResult['outputFiles'];
        stderr?: string;
        stdout?: string;
        success?: boolean;
      };

      // `response.success` is the delivery envelope only: the device-side
      // ComputerRuntime reports service failures (spawn error, shell lost,
      // missing params) as `success: true` with `state.success: false` and no
      // exitCode (`errorOutput`) — without this check they'd fall through to
      // the still-running branch below and read as a successful run.
      if (!response.success || state.success === false) {
        return fail(
          state.stderr ||
            state.error ||
            response.error ||
            response.content ||
            'Command execution failed on the device',
        );
      }

      // The device shell reports success for any delivered observation, even
      // when the command exited non-zero (the exit status only lives in
      // exitCode) — derive success from the exit status instead. An undefined
      // exitCode means the command is still running past the observation
      // window: pass it through with the shell handle so the formatter
      // reports a running command (pollable via local-system.getCommandOutput)
      // instead of pretending completion.
      const exitCode = state.exitCode;
      return {
        executionEnv: 'device',
        exitCode,
        output: state.stdout ?? response.content ?? '',
        // Large streams are truncated to a preview device-side with the full
        // output saved to disk — the paths are the only retrieval handle.
        outputFiles: state.outputFiles,
        shellId: state.commandId,
        stderr: state.stderr,
        success: exitCode === undefined || exitCode === 0,
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
    // Execution target follows the run's plan: a routed device wins over the
    // sandbox (restores the pre-gateway desktop behavior).
    if (this.device) {
      const deviceResult = await this.execScriptOnDevice(command, options.activatedSkills);
      if (deviceResult !== LEGACY_DEVICE_CLIENT) return deviceResult;

      // Version-skew fallback: the client predates the RPC. Run the sandbox
      // path but disclose the degradation in stderr so the model relays it.
      const sandboxResult = await this.execScriptInSandbox(command, options);
      return {
        ...sandboxResult,
        stderr: [sandboxResult.stderr, LEGACY_FALLBACK_NOTE].filter(Boolean).join('\n'),
      };
    }

    return this.execScriptInSandbox(command, options);
  };

  private execScriptInSandbox = async (
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
    // Same manifest-hidden guard as `runCommand`: the message reaches the
    // model through the ExecutionRuntime catch ("Failed to export file: ...").
    if (this.device) {
      throw new Error(
        "exportFile pulls artifacts out of the cloud sandbox and is unavailable while a local device is routed — files created on the device are already on the user's machine.",
      );
    }

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

    // Independent of `<available_skills>` (built once, earlier, in
    // aiAgent/index.ts) — this runtime resolves skills fresh by name/id, so a
    // model that already knows a disabled skill's name (prior turn, or a
    // guess) could otherwise still activate/run it. Re-derive the disabled
    // set here so this path enforces the same tri-state.
    let disabledSkillIds = new Set<string>();
    if (context.agentId) {
      const agentModel = new AgentModel(context.serverDB, context.userId, context.workspaceId);
      const agentConfig = await agentModel.getAgentConfigById(context.agentId);
      disabledSkillIds = new Set(getDisabledPluginIds(agentConfig?.plugins ?? undefined));
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

    // `activeDeviceId` presence is the device-branch switch: execScript then
    // runs on the device instead of the cloud sandbox. The executors filter
    // the raw metadata id through `resolveRunActiveDeviceId` (plan/policy
    // gate) before it reaches this context, so a preset or stale id cannot
    // route execution onto a device the resolved plan didn't authorize;
    // `device-unrouted` runs keep the sandbox path (with the unrouted
    // disclosure in the manifest).
    let workspaceIdPromise: Promise<string | undefined> | undefined;
    const device: SkillDeviceExecution | undefined = context.activeDeviceId
      ? {
          deviceId: context.activeDeviceId,
          executionTimeoutMs: context.executionTimeoutMs,
          operationId: context.operationId,
          projectSkills: context.projectSkills,
          // Same lazy workspace-principal recovery as the local-system runtime,
          // so workspace devices are addressed under the right gateway pool.
          resolveWorkspaceId: () => (workspaceIdPromise ??= resolveRunWorkspaceId(context)),
          workingDirectory: context.workingDirectory,
        }
      : undefined;

    const service = new SkillServerRuntimeService({
      agentId: context.agentId,
      device,
      disabledSkillIds,
      fileModel,
      fileService,
      marketService,
      resourceService,
      serverDB: context.serverDB,
      skillModel,
      topicId: context.topicId,
      userId: context.userId,
      workspaceId: context.workspaceId,
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
            skills
              .filter((skill) => !disabledSkillIds.has(skill.identifier))
              .map((skill) => ({
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
      // Resolved by the runtime executors from the operation's message
      // history (the server-side stepContext equivalent); execScript falls
      // back to these because the raw LLM args never carry activatedSkills.
      activatedSkills: context.activatedSkills,
      builtinSkills: [
        // Device-only skills resolve in device-capable runs — mirrors the
        // SkillEngine gate in aiAgent that builds <available_skills>, so a
        // `device-unrouted` run can activate/read them before the model routes
        // a device. `activeDeviceId` is the fallback for callers without an
        // execution plan.
        ...filterBuiltinSkills(builtinSkills, {
          canExecuteOnDevice: context.deviceCapable ?? !!activeDeviceId,
        }).filter((skill) => !disabledSkillIds.has(skill.identifier)),
        ...agentSkillBuiltins,
      ],
      deviceFileAccess,
      projectSkills,
      service,
    });
  },
  identifier: SkillsIdentifier,
};
