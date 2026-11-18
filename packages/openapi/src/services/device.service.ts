import { LocalSystemApiName, LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import type { DeviceListItem } from '@lobechat/types';
import { z } from 'zod';

import { DeviceModel } from '@/database/models/device';
import type { LobeChatDatabase } from '@/database/type';
import { deviceRouter } from '@/server/routers/lambda/device';
import { deviceMetricRouter } from '@/server/routers/lambda/deviceMetric';
import {
  assertWorkspaceRootApproved,
  canOperateWorkspaceDevice,
} from '@/server/routers/lambda/deviceWorkspaceGuard';
import { executeAuthorizedDeviceToolCall } from '@/server/services/deviceGateway/authorizedToolCall';

import { BaseService } from '../common/base.service';
import { ApiException } from '../common/errors';
import { resolvePagination } from '../helpers/pagination';
import type {
  DeviceCommandResponse,
  DeviceDetailQuery,
  DeviceDetailResponse,
  DeviceFileContentQuery,
  DeviceFileContentResponse,
  DeviceFileListQuery,
  DeviceFileListResponse,
  DeviceGitDiffQuery,
  DeviceGitDiffResponse,
  DeviceGitLogQuery,
  DeviceGitLogResponse,
  DeviceGitOperationRequest,
  DeviceGitOperationResponse,
  DeviceGitQuery,
  DeviceGitStatusResponse,
  DeviceResponse,
  RunDeviceCommandRequest,
  WriteDeviceFileRequest,
} from '../types/device.type';
import type { DeviceAuditActor, DeviceAuditEntry } from './device-audit';
import { recordDeviceAudit, runAudited } from './device-audit';

type DeviceCaller = ReturnType<typeof deviceRouter.createCaller>;
type WorkspaceRole = Parameters<typeof canOperateWorkspaceDevice>[0];
type MetricCaller = ReturnType<typeof deviceMetricRouter.createCaller>;

const DEFAULT_METRICS_WINDOW_MS = 60 * 60 * 1000;

/** Gateway results that mean the call never reached a device that could answer. */
const UNAVAILABLE_ERRORS = new Set([
  'DEVICE_NOT_FOUND',
  'DEVICE_OFFLINE',
  'GATEWAY_NOT_CONFIGURED',
  'NO_CAPABLE_CONNECTION',
  'TIMEOUT',
]);

/**
 * What the device's `runCommand` reports (`RunCommandState`), read
 * defensively: older clients send the raw snake_case shell result, or less.
 */
const OUTPUT_FILE = z.object({ truncated: z.boolean().optional() }).optional();

const RunCommandStateSchema = z
  .object({
    commandId: z.string(),
    exit_code: z.number().int(),
    exitCode: z.number().int(),
    output: z.string(),
    running: z.boolean(),
    shell_id: z.string(),
    stderr: z.string(),
    stdout: z.string(),
    success: z.boolean(),
  })
  .partial()
  .extend({
    // what the device kept inline is a head/tail preview when these say so
    output_files: z.object({ stderr: OUTPUT_FILE, stdout: OUTPUT_FILE }).partial().optional(),
    outputFiles: z.object({ stderr: OUTPUT_FILE, stdout: OUTPUT_FILE }).partial().optional(),
  });

const toDevice = (item: DeviceListItem): DeviceResponse => ({
  architecture: item.architecture ?? null,
  channels: item.channels.map((channel) => ({
    channel: channel.channel,
    connectedAt: channel.connectedAt,
    hostname: channel.hostname,
    platform: channel.platform,
  })),
  defaultCwd: item.defaultCwd,
  friendlyName: item.friendlyName,
  hostname: item.hostname,
  id: item.deviceId,
  lastSeen: item.lastSeen,
  metadata: item.metadata ?? null,
  online: item.online,
  platform: item.platform,
  registered: item.registered,
  scope: item.scope,
  visibility: item.visibility,
  workingDirectories: item.workingDirs.map((dir) => ({
    path: dir.path,
    repoType: dir.repoType ?? null,
  })),
});

/**
 * Characters a path may hold to be put on a device command line. Letters and
 * digits of any script, spaces and the path punctuation of POSIX and Windows —
 * and nothing any of the device shells (sh, zsh, PowerShell, cmd.exe) treats
 * as syntax: no quote of any kind (PowerShell also closes a string on the
 * typographic ones), no `$`, `;`, `&`, `|`, `%`, backtick or brackets.
 */
const SHELL_SAFE_PATH = /^[\p{L}\p{N} _./\\:~@+,-]+$/u;

/** One path argument for the device shell, single-quoted after the allow-list above. */
const quotePath = (value: string) => {
  if (!SHELL_SAFE_PATH.test(value)) {
    throw new ApiException(
      400,
      'validation_error',
      'This path holds characters that cannot be passed to the device shell',
    );
  }
  return `'${value}'`;
};

const FIELD_SEPARATOR = '\u001F';

/**
 * Devices on the public REST API.
 *
 * Reads go through the `device` / `deviceMetric` tRPC procedures, called
 * server-side, so REST answers with the same visibility rules the app does.
 * Commands go through `executeAuthorizedDeviceToolCall` — the device gateway
 * path agent runs dispatch `runCommand` on, with its last-moment registry
 * check — so there is no second way onto a machine.
 *
 * Every write first passes {@link assertOperable} and is then recorded with
 * {@link recordDeviceAudit}.
 */
export class DeviceRestService extends BaseService {
  private readonly caller: DeviceCaller;
  private readonly metricCaller: MetricCaller;
  private readonly deviceModel: DeviceModel;

  constructor(
    db: LobeChatDatabase,
    userId: string | null,
    workspaceId: string | undefined,
    private readonly actor: Omit<DeviceAuditActor, 'userId' | 'workspaceId'> & {
      workspaceRole?: WorkspaceRole;
    } = {},
  ) {
    super(db, userId, workspaceId);
    this.caller = deviceRouter.createCaller({ userId: this.userId, workspaceId });
    this.metricCaller = deviceMetricRouter.createCaller({ userId: this.userId, workspaceId });
    this.deviceModel = new DeviceModel(db, this.userId, workspaceId);
  }

  // ==================== Access ====================

  /**
   * The stored device the caller may reach in the current scope: in a
   * workspace, one of its devices the caller can see (public, or their own
   * private enrollment); otherwise one of the caller's own machines. Anything
   * else — another user's device, another workspace's — is a 404, never a
   * hint that it exists.
   */
  private async requireDeviceRow(id: string) {
    const row = this.workspaceId
      ? await this.deviceModel.findWorkspaceDeviceById(id)
      : await this.deviceModel.findPersonalByDeviceId(id);
    if (!row) throw this.createNotFoundError('Device not found');
    return row;
  }

  /**
   * Gate a write the way the app gates operating a machine: a personal device
   * belongs to the caller; a workspace device may be operated by any member
   * when it is public, and only by its enroller or an owner when private.
   */
  private async assertOperable(id: string) {
    const row = await this.requireDeviceRow(id);
    if (!this.workspaceId) return;

    if (!canOperateWorkspaceDevice(this.actor.workspaceRole, this.userId, row)) {
      throw this.createAuthorizationError(
        row.visibility === 'public'
          ? 'Workspace viewers cannot operate this device'
          : 'Only the enrolling member or a workspace owner can operate this private device',
      );
    }
  }

  private audit(entry: Omit<DeviceAuditEntry, 'resourceType'>) {
    return recordDeviceAudit(
      this.db,
      { ...this.actor, userId: this.userId, workspaceId: this.workspaceId },
      { ...entry, resourceType: 'device' },
    );
  }

  private audited<T>(
    entry: Omit<DeviceAuditEntry, 'resourceType'>,
    work: () => Promise<T>,
    outcome: (result: T) => Record<string, unknown>,
  ) {
    return runAudited((done) => this.audit(done), entry, work, outcome);
  }

  /**
   * Reads that take a directory stay inside the device's approved working
   * directories — the rule file previews already follow — so a read key
   * cannot list, diff or log an arbitrary repository on the machine.
   */
  private assertApprovedRoot(id: string, path: string) {
    return assertWorkspaceRootApproved(this.deviceModel, id, path, this.workspaceId);
  }

  /** A device's live result, or a 503 that says the device could not answer. */
  private requireOnline<T>(result: T | null | undefined, id: string): T {
    if (result === null || result === undefined) {
      throw new ApiException(503, 'service_unavailable', `Device ${id} is offline or unreachable`);
    }
    return result;
  }

  // ==================== Devices ====================

  async listDevices(query: { cursor?: string; limit?: number }) {
    const all = (await this.caller.listDevices())
      // with a workspace, its devices only — the same set every `{id}` route accepts
      .filter((item) => !this.workspaceId || item.scope === 'workspace')
      .map(toDevice);
    const { limit, offset } = resolvePagination(query);

    return { items: all.slice(offset, offset + limit), total: all.length };
  }

  async getDevice(id: string, query: DeviceDetailQuery): Promise<DeviceDetailResponse> {
    await this.requireDeviceRow(id);
    const item = (await this.caller.listDevices()).find(
      (device) =>
        device.deviceId === id && (this.workspaceId ? device.scope === 'workspace' : true),
    );
    if (!item) throw this.createNotFoundError('Device not found');

    const scope = this.workspaceId ? 'workspace' : 'personal';
    const [systemInfo, metrics] = await Promise.all([
      item.online ? this.caller.getDeviceSystemInfo({ deviceId: id }) : Promise.resolve(undefined),
      this.metricCaller.getSeries({
        deviceId: id,
        scope,
        windowMs: query.metricsWindowMs ?? DEFAULT_METRICS_WINDOW_MS,
      }),
    ]);

    return {
      ...toDevice(item),
      metrics,
      systemInfo: systemInfo
        ? {
            arch: systemInfo.arch,
            defaultShell: systemInfo.defaultShell ?? null,
            homePath: systemInfo.homePath,
            workingDirectory: systemInfo.workingDirectory,
          }
        : null,
    };
  }

  // ==================== Files ====================

  async listFiles(id: string, query: DeviceFileListQuery): Promise<DeviceFileListResponse> {
    await this.requireDeviceRow(id);
    await this.assertApprovedRoot(id, query.root);
    const result = this.requireOnline(
      await this.caller.listProjectDirectory({
        deviceId: id,
        relativePath: query.path,
        root: query.root,
      }),
      id,
    );

    return {
      entries: result.entries.map((entry) => ({
        gitIgnored: entry.gitIgnored ?? false,
        isDirectory: entry.isDirectory,
        name: entry.name,
        path: entry.path,
        relativePath: entry.relativePath,
      })),
      truncated: result.truncated,
    };
  }

  async readFile(id: string, query: DeviceFileContentQuery): Promise<DeviceFileContentResponse> {
    await this.requireDeviceRow(id);
    const result = await this.caller.getLocalFilePreview({
      deviceId: id,
      path: query.path,
      workingDirectory: query.workingDirectory,
    });
    if (!result.success || !result.preview) {
      throw new ApiException(
        result.error ? 422 : 503,
        result.error ? 'unprocessable_entity' : 'service_unavailable',
        result.error ?? `Device ${id} is offline or unreachable`,
      );
    }

    const { preview } = result;
    const base = { contentType: preview.contentType, path: query.path, type: preview.type };
    if (preview.type === 'text') return { ...base, content: preview.content, encoding: 'utf8' };
    if (preview.type === 'image' || preview.type === 'document')
      return { ...base, content: preview.base64, encoding: 'base64' };
    return { ...base, content: null, encoding: null };
  }

  async writeFile(id: string, request: WriteDeviceFileRequest) {
    await this.assertOperable(id);
    const result = await this.audited(
      {
        action: 'device.file_written',
        metadata: {
          bytes: Buffer.byteLength(request.content),
          path: request.path,
          workingDirectory: request.workingDirectory,
        },
        resourceId: id,
      },
      () =>
        this.caller.writeProjectFile({
          content: request.content,
          deviceId: id,
          path: request.path,
          workingDirectory: request.workingDirectory,
        }),
      (written) => ({ error: written.error ?? null, success: written.success }),
    );

    if (!result.success) {
      throw new ApiException(
        422,
        'unprocessable_entity',
        result.error ?? 'The device refused the write',
      );
    }
    return { path: request.path, written: true as const };
  }

  // ==================== Git ====================

  async gitStatus(id: string, { path }: DeviceGitQuery): Promise<DeviceGitStatusResponse> {
    await this.requireDeviceRow(id);
    await this.assertApprovedRoot(id, path);
    const [status, files, branch, aheadBehind] = await Promise.all([
      this.caller.gitWorkingTreeStatus({ deviceId: id, path }),
      this.caller.getGitWorkingTreeFiles({ deviceId: id, path }),
      this.caller.gitBranch({ deviceId: id, path }),
      this.caller.gitAheadBehind({ deviceId: id, path }),
    ]);
    const counts = this.requireOnline(status, id);

    return {
      ahead: aheadBehind?.hasUpstream ? aheadBehind.ahead : null,
      behind: aheadBehind?.hasUpstream ? aheadBehind.behind : null,
      branch: branch?.branch ?? null,
      clean: counts.clean,
      counts: {
        added: counts.added,
        deleted: counts.deleted,
        modified: counts.modified,
        total: counts.total,
      },
      detached: branch?.detached ?? false,
      files: {
        added: files?.added ?? [],
        deleted: files?.deleted ?? [],
        modified: files?.modified ?? [],
      },
      upstream: aheadBehind?.upstream ?? null,
    };
  }

  /**
   * The device has no log RPC, so the log is read with one fixed `git log`
   * the server builds itself — through the same gateway `runCommand` path —
   * from validated arguments only: the path must be one of the device's
   * approved working directories and pass {@link SHELL_SAFE_PATH}, the ref
   * matches a strict pattern, and the caller contributes no shell text.
   */
  async gitLog(id: string, query: DeviceGitLogQuery): Promise<DeviceGitLogResponse> {
    await this.requireDeviceRow(id);
    await this.assertApprovedRoot(id, query.path);
    const format = ['%H', '%h', '%an', '%ae', '%aI', '%s'].join('%x1f');
    const command = [
      'git',
      '-C',
      quotePath(query.path),
      'log',
      `--max-count=${query.limit}`,
      `--format=${format}`,
      query.ref ?? 'HEAD',
      '--',
    ].join(' ');

    const result = await this.runOnDevice(id, command, 'Read the git log', 30_000);
    // a cut-down preview would parse into a history with a silent gap in the middle
    if (result.truncated) {
      throw new ApiException(
        413,
        'payload_too_large',
        'This git history is larger than the device returns inline; request fewer commits with `limit`',
      );
    }
    // an unknown ref or a directory that is no repository exits non-zero
    if (!result.success || result.running || result.exitCode !== 0) {
      throw new ApiException(
        422,
        'unprocessable_entity',
        result.stderr || result.output || 'git log failed',
      );
    }

    const commits = (result.stdout ?? result.output)
      .split('\n')
      .map((line) => line.trim().split(FIELD_SEPARATOR))
      .filter((fields) => fields.length === 6)
      .map(([sha, shortSha, authorName, authorEmail, committedAt, subject]) => ({
        authorEmail,
        authorName,
        committedAt,
        sha,
        shortSha,
        subject,
      }));

    return { commits };
  }

  async gitDiff(id: string, query: DeviceGitDiffQuery): Promise<DeviceGitDiffResponse> {
    await this.requireDeviceRow(id);
    // patches carry file contents (untracked files included): approved roots only
    await this.assertApprovedRoot(id, query.path);
    const refs = { baseRef: null as string | null, headRef: null as string | null };
    let diff;
    if (query.against === 'branch') {
      const branchDiff = this.requireOnline(
        await this.caller.getGitBranchDiff({
          baseRef: query.baseRef,
          deviceId: id,
          path: query.path,
        }),
        id,
      );
      refs.baseRef = branchDiff.baseRef ?? null;
      refs.headRef = branchDiff.headRef ?? null;
      diff = branchDiff;
    } else {
      diff = this.requireOnline(
        await this.caller.getGitWorkingTreePatches({ deviceId: id, path: query.path }),
        id,
      );
    }

    return {
      ...refs,
      patches: diff.patches,
      submodules: (diff.submodules ?? []).map((submodule) => ({
        name: submodule.name,
        patches: submodule.patches,
        relativePath: submodule.relativePath,
      })),
    };
  }

  async gitOperate(
    id: string,
    request: DeviceGitOperationRequest,
  ): Promise<DeviceGitOperationResponse> {
    await this.assertOperable(id);

    // one shape for all three: checkout answers without `branch` / `noop`
    const operate = async (): Promise<{
      branch?: string;
      error?: string;
      noop?: boolean;
      success: boolean;
    }> =>
      request.action === 'checkout'
        ? this.caller.checkoutGitBranch({
            branch: request.branch,
            create: request.create,
            deviceId: id,
            path: request.path,
            startPoint: request.startPoint,
          })
        : request.action === 'pull'
          ? this.caller.pullGitBranch({ branch: request.branch, deviceId: id, path: request.path })
          : this.caller.pushGitBranch({ branch: request.branch, deviceId: id, path: request.path });

    const result = await this.audited(
      { action: 'device.git_operated', metadata: { ...request }, resourceId: id },
      operate,
      (done) => ({ error: done.error ?? null, success: done.success }),
    );

    return {
      action: request.action,
      branch: request.branch ?? result.branch ?? null,
      error: result.error ?? null,
      noop: !!result.noop,
      success: result.success,
    };
  }

  // ==================== Commands ====================

  async runCommand(id: string, request: RunDeviceCommandRequest): Promise<DeviceCommandResponse> {
    await this.assertOperable(id);

    const entry = {
      action: 'device.command_executed' as const,
      metadata: { command: request.command, description: request.description ?? null },
      resourceId: id,
    };
    // A command can outlive the request that started it, so the dispatch is on
    // record before the device is asked; the outcome follows as a second entry.
    await this.audit({ ...entry, metadata: { ...entry.metadata, phase: 'dispatched' } });

    return this.audited(
      { ...entry, metadata: { ...entry.metadata, phase: 'completed' } },
      () => this.runOnDevice(id, request.command, request.description, request.timeoutMs),
      (result) => ({
        error: null,
        exitCode: result.exitCode,
        running: result.running,
        success: result.success,
      }),
    );
  }

  /** Dispatch `runCommand` through the authorized device gateway path. */
  private async runOnDevice(
    id: string,
    command: string,
    description: string | undefined,
    timeoutMs: number,
  ): Promise<DeviceCommandResponse> {
    const result = await executeAuthorizedDeviceToolCall(
      this.db,
      { deviceId: id, userId: this.userId, workspaceId: this.workspaceId },
      {
        apiName: LocalSystemApiName.runCommand,
        arguments: JSON.stringify({
          command,
          description: description ?? 'Run a command from the LobeHub API',
          timeout: timeoutMs,
        }),
        identifier: LocalSystemIdentifier,
      },
      // the gateway waits a little longer than the command, so its output comes back
      timeoutMs + 15_000,
    );

    if (!result.success && result.error && UNAVAILABLE_ERRORS.has(result.error)) {
      throw new ApiException(503, 'service_unavailable', result.content || result.error);
    }

    const state = RunCommandStateSchema.safeParse(result.state ?? {});
    const parsed = state.success ? state.data : {};

    return {
      exitCode: parsed.exitCode ?? parsed.exit_code ?? null,
      truncated: [parsed.outputFiles, parsed.output_files].some(
        (files) => !!files?.stdout?.truncated || !!files?.stderr?.truncated,
      ),
      output: parsed.output ?? parsed.stdout ?? result.content ?? '',
      running: parsed.running ?? false,
      shellId: parsed.commandId ?? parsed.shell_id ?? null,
      stderr: parsed.stderr ?? null,
      stdout: parsed.stdout ?? null,
      // the device reports `success` for "the shell started"; a command that
      // exited non-zero did not succeed, whatever that flag says
      success:
        (parsed.success ?? result.success) && (parsed.exitCode ?? parsed.exit_code ?? 0) === 0,
    };
  }
}
