import { type DeviceAttachment } from '@lobechat/builtin-tool-remote-device';
import {
  describeGatewayRequestFailure,
  type DeviceStatusResult,
  type DeviceSystemInfo,
  GatewayHttpClient,
} from '@lobechat/device-gateway-client';
import type { DeviceClient, DeviceMetricSample } from '@lobechat/types';
import debug from 'debug';

import { gatewayEnv } from '@/envs/gateway';
import { redisService } from '@/server/services/redis';

import * as agents from './agents';
import { resolveDeviceClientKinds } from './clientKinds';
import * as clientUpdate from './clientUpdate';
import * as gitRead from './gitRead';
import * as gitWrite from './gitWrite';
import * as projectFileMutations from './projectFileMutations';
import * as projectFiles from './projectFiles';
import * as terminal from './terminal';
import type { DeviceClientGetter, DeviceRpcArgs } from './types';
import * as workspace from './workspace';

const log = debug('lobe-server:device-gateway');

export { isPathWithinRoot, joinDevicePath } from './paths';
export { isValidDirectoryName } from '@lobechat/utils/directoryName';

export type { DeviceAttachment, DeviceStatusResult, DeviceSystemInfo };

/**
 * Outcome of a device system-info read. `reason` is the gateway's code when it
 * gave one (`TIMEOUT`, `DEVICE_OFFLINE`, `DEVICE_NOT_FOUND`), otherwise a local one.
 */
export type DeviceSystemInfoRead =
  { ok: true; systemInfo: DeviceSystemInfo } | { ok: false; reason: string };

/** One extra attempt for a device read; see `readDevices`. */
const DEVICE_READ_ATTEMPTS = 2;
const DEVICE_READ_RETRY_DELAY_MS = 250;

/**
 * The gateway service. Device presence reads live here; every other device RPC
 * is a module function (`gitRead`, `projectFiles`, `terminal`, …) that this
 * class exposes under its original method name, handing it the lazy client.
 */
export class DeviceGateway {
  private client: GatewayHttpClient | null = null;

  private readonly clientGetter: DeviceClientGetter = () => this.getClient();

  /**
   * Run a device READ, retrying once and reporting the fallback out loud.
   *
   * These reads decide which devices a run may reach, and the fallback value is
   * indistinguishable from a legitimately empty pool: a single dropped
   * connection therefore reads as "every device is offline", which sends a
   * device-bound run to the cloud sandbox instead. Retrying absorbs the blip,
   * and the warning leaves the breadcrumb that was missing entirely — the old
   * bare `catch {}` made this failure invisible in every log.
   */
  private async readDevices<T>(
    label: string,
    context: { userId: string; workspaceId?: string },
    read: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    for (let attempt = 1; attempt <= DEVICE_READ_ATTEMPTS; attempt++) {
      try {
        return await read();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt < DEVICE_READ_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, DEVICE_READ_RETRY_DELAY_MS));
          continue;
        }
        console.warn(`[DeviceGateway] ${label} failed; treating the online set as empty`, {
          attempts: attempt,
          error: message,
          userId: context.userId,
          workspaceId: context.workspaceId,
        });
      }
    }
    return fallback;
  }

  get isConfigured(): boolean {
    return !!gatewayEnv.DEVICE_GATEWAY_URL;
  }

  async queryDeviceStatus(userId: string, workspaceId?: string): Promise<DeviceStatusResult> {
    const client = this.getClient();
    if (!client) return { deviceCount: 0, online: false };

    return this.readDevices(
      'queryDeviceStatus',
      { userId, workspaceId },
      () => client.queryDeviceStatus(userId, workspaceId),
      { deviceCount: 0, online: false },
    );
  }

  // Pass a `workspaceId` to address a workspace-owned device pool (the gateway
  // routes to the `workspace:<id>` principal); omit it for the personal pool.
  async queryDeviceList(userId: string, workspaceId?: string): Promise<DeviceAttachment[]> {
    const client = this.getClient();
    if (!client) return [];

    return this.readDevices(
      'queryDeviceList',
      { userId, workspaceId },
      async () => {
        const devices = await client.queryDeviceList(userId, workspaceId);
        // The gateway already dedupes to one entry per physical device, with its
        // live connections nested as `channels`. Map to the runtime shape; every
        // returned device has at least one channel, so it's online.
        return devices.map((d) => ({
          // `channels` may be absent if the gateway worker deploy lags behind the
          // server (separate Cloudflare deploy); tolerate the legacy flat shape.
          //
          // Sorted newest-first because every consumer reads `channels[0]` as
          // "this device's current connection" — the settings row's
          // "Connected {time}", a ghost row's `lastSeen`, its hostname/platform
          // fallback — while `sortDevicesByActivity` ranks by the FRESHEST
          // channel. The gateway promises no order, so leaving it raw lets a
          // multi-channel device rank by one connection and get labelled with
          // another. Normalising here (the single entry point both `listDevices`
          // and `getScopedOnlineDevices` pull channels through) makes
          // `channels[0]` mean the same thing everywhere.
          channels: (d.channels ?? [])
            .map((c) => ({
              channel: c.channel,
              connectedAt: new Date(c.connectedAt).toISOString(),
              connectionId: c.connectionId,
            }))
            .sort((a, b) => Date.parse(b.connectedAt) - Date.parse(a.connectedAt)),
          deviceId: d.deviceId,
          hostname: d.hostname,
          lastSeen: new Date(d.connectedAt).toISOString(),
          online: true,
          platform: d.platform,
        }));
      },
      [],
    );
  }

  /**
   * The device's system info, preferring the desktop app's answer: its
   * `supportedTools` gate desktop-only tools, and when `lh connect` is up on the
   * same device an unconstrained read is answered by the CLI, which reports
   * none. When the desktop read fails for any reason, ask whichever client the
   * device has: a device without the desktop app answers `NO_CAPABLE_CONNECTION`,
   * and a desktop that timed out or whose socket is closing (`TIMEOUT`,
   * `DEVICE_OFFLINE`) may still sit beside a live `lh connect`, which is the
   * answer canary got. A gateway that predates `clientKinds` answers the first
   * read as before.
   *
   * `maxAgeMs` lets a caller accept an answer this device gave within that
   * window instead of a fresh round trip over its WebSocket. The send path
   * asks every turn and the answer changes only when the client upgrades or
   * the user moves the daemon, so a few minutes of staleness there is a
   * round trip saved per send; callers that need the live answer (an
   * explicit device inspection) leave it unset. Only successful answers are
   * remembered — an offline device is asked again next time.
   */
  async queryDeviceSystemInfo(
    userId: string,
    deviceId: string,
    workspaceId?: string,
    options?: { maxAgeMs?: number },
  ): Promise<DeviceSystemInfo | undefined> {
    const query = async () => {
      const desktop = await this.readDeviceSystemInfo(userId, deviceId, workspaceId, {
        clientKinds: ['desktop'],
      });
      if (desktop.ok) return desktop.systemInfo;

      const any = await this.readDeviceSystemInfo(userId, deviceId, workspaceId);
      return any.ok ? any.systemInfo : undefined;
    };

    const maxAgeMs = options?.maxAgeMs;
    if (!maxAgeMs || maxAgeMs <= 0) return query();

    return redisService.deviceSystemInfo.remember(
      { userId, deviceId, workspaceId },
      query,
      maxAgeMs,
    );
  }

  /**
   * Like {@link queryDeviceSystemInfo}, but a failed read says why. Use it when
   * "the device did not answer" must not be mistaken for "the device answered
   * without this capability" — e.g. gating a tool on `supportedTools`.
   */
  async readDeviceSystemInfo(
    userId: string,
    deviceId: string,
    workspaceId?: string,
    options?: { clientKinds?: DeviceClient[] },
  ): Promise<DeviceSystemInfoRead> {
    const client = this.getClient();
    if (!client) return { ok: false, reason: 'GATEWAY_NOT_CONFIGURED' };

    try {
      const result = await client.getDeviceSystemInfo(userId, deviceId, workspaceId, options);
      if (result.success && result.systemInfo) return { ok: true, systemInfo: result.systemInfo };
      log(
        'readDeviceSystemInfo: unanswered for userId=%s, deviceId=%s: %s',
        userId,
        deviceId,
        result.error,
      );
      return { ok: false, reason: result.error ?? 'NO_SYSTEM_INFO' };
    } catch (error) {
      log('readDeviceSystemInfo: failed for userId=%s, deviceId=%s: %O', userId, deviceId, error);
      return { ok: false, reason: describeGatewayRequestFailure(error, 'RPC call').code };
    }
  }

  /**
   * The device's health samples held by the gateway (two days), observed at or
   * after `since`. Unlike the RPC reads this works while the device is
   * offline — the samples live in gateway storage, not on the device.
   *
   * A failed read degrades to no samples: the chart is a polled side panel,
   * and surfacing a gateway blip as a 500 only turns each poll (and its SWR
   * retries) into an error log. The next poll picks the history back up.
   */
  async queryDeviceMetrics(params: {
    deviceId: string;
    since: number;
    userId: string;
    workspaceId?: string;
  }): Promise<DeviceMetricSample[]> {
    const client = this.getClient();
    if (!client) return [];
    try {
      return await client.getDeviceMetrics(params.userId, params.deviceId, {
        since: params.since,
        workspaceId: params.workspaceId,
      });
    } catch (error) {
      console.warn('[DeviceGateway] device metrics read failed; returning no samples', {
        deviceId: params.deviceId,
        error: error instanceof Error ? error.message : String(error),
        userId: params.userId,
        workspaceId: params.workspaceId,
      });
      return [];
    }
  }

  initWorkspace(...args: DeviceRpcArgs<typeof workspace.initWorkspace>) {
    return workspace.initWorkspace(this.clientGetter, ...args);
  }

  prepareSkillDirectory(...args: DeviceRpcArgs<typeof workspace.prepareSkillDirectory>) {
    return workspace.prepareSkillDirectory(this.clientGetter, ...args);
  }

  enrollWorkspace(...args: DeviceRpcArgs<typeof workspace.enrollWorkspace>) {
    return workspace.enrollWorkspace(this.clientGetter, ...args);
  }

  unenrollWorkspace(...args: DeviceRpcArgs<typeof workspace.unenrollWorkspace>) {
    return workspace.unenrollWorkspace(this.clientGetter, ...args);
  }

  gitBranch(...args: DeviceRpcArgs<typeof gitRead.gitBranch>) {
    return gitRead.gitBranch(this.clientGetter, ...args);
  }

  gitLinkedPullRequest(...args: DeviceRpcArgs<typeof gitRead.gitLinkedPullRequest>) {
    return gitRead.gitLinkedPullRequest(this.clientGetter, ...args);
  }

  gitPullRequestDetail(...args: DeviceRpcArgs<typeof gitRead.gitPullRequestDetail>) {
    return gitRead.gitPullRequestDetail(this.clientGetter, ...args);
  }

  gitPullRequestActivity(...args: DeviceRpcArgs<typeof gitRead.gitPullRequestActivity>) {
    return gitRead.gitPullRequestActivity(this.clientGetter, ...args);
  }

  gitPullRequestMergeContext(...args: DeviceRpcArgs<typeof gitRead.gitPullRequestMergeContext>) {
    return gitRead.gitPullRequestMergeContext(this.clientGetter, ...args);
  }

  gitWorkingTreeStatus(...args: DeviceRpcArgs<typeof gitRead.gitWorkingTreeStatus>) {
    return gitRead.gitWorkingTreeStatus(this.clientGetter, ...args);
  }

  gitAheadBehind(...args: DeviceRpcArgs<typeof gitRead.gitAheadBehind>) {
    return gitRead.gitAheadBehind(this.clientGetter, ...args);
  }

  claudeCodeQuota(...args: DeviceRpcArgs<typeof agents.claudeCodeQuota>) {
    return agents.claudeCodeQuota(this.clientGetter, ...args);
  }

  codexQuota(...args: DeviceRpcArgs<typeof agents.codexQuota>) {
    return agents.codexQuota(this.clientGetter, ...args);
  }

  kimiCodeQuota(...args: DeviceRpcArgs<typeof agents.kimiCodeQuota>) {
    return agents.kimiCodeQuota(this.clientGetter, ...args);
  }

  listGitWorktrees(...args: DeviceRpcArgs<typeof gitRead.listGitWorktrees>) {
    return gitRead.listGitWorktrees(this.clientGetter, ...args);
  }

  listHeterogeneousAgentModels(...args: DeviceRpcArgs<typeof agents.listHeterogeneousAgentModels>) {
    return agents.listHeterogeneousAgentModels(this.clientGetter, ...args);
  }

  listGitBranches(...args: DeviceRpcArgs<typeof gitRead.listGitBranches>) {
    return gitRead.listGitBranches(this.clientGetter, ...args);
  }

  checkoutGitBranch(...args: DeviceRpcArgs<typeof gitWrite.checkoutGitBranch>) {
    return gitWrite.checkoutGitBranch(this.clientGetter, ...args);
  }

  renameGitBranch(...args: DeviceRpcArgs<typeof gitWrite.renameGitBranch>) {
    return gitWrite.renameGitBranch(this.clientGetter, ...args);
  }

  deleteGitBranch(...args: DeviceRpcArgs<typeof gitWrite.deleteGitBranch>) {
    return gitWrite.deleteGitBranch(this.clientGetter, ...args);
  }

  removeGitWorktree(...args: DeviceRpcArgs<typeof gitWrite.removeGitWorktree>) {
    return gitWrite.removeGitWorktree(this.clientGetter, ...args);
  }

  addGitWorktree(...args: DeviceRpcArgs<typeof gitWrite.addGitWorktree>) {
    return gitWrite.addGitWorktree(this.clientGetter, ...args);
  }

  pullGitBranch(...args: DeviceRpcArgs<typeof gitWrite.pullGitBranch>) {
    return gitWrite.pullGitBranch(this.clientGetter, ...args);
  }

  pushGitBranch(...args: DeviceRpcArgs<typeof gitWrite.pushGitBranch>) {
    return gitWrite.pushGitBranch(this.clientGetter, ...args);
  }

  runGitPullRequestAction(...args: DeviceRpcArgs<typeof gitWrite.runGitPullRequestAction>) {
    return gitWrite.runGitPullRequestAction(this.clientGetter, ...args);
  }

  getGitWorkingTreePatches(...args: DeviceRpcArgs<typeof gitRead.getGitWorkingTreePatches>) {
    return gitRead.getGitWorkingTreePatches(this.clientGetter, ...args);
  }

  getGitBranchDiff(...args: DeviceRpcArgs<typeof gitRead.getGitBranchDiff>) {
    return gitRead.getGitBranchDiff(this.clientGetter, ...args);
  }

  getGitWorkingTreeFiles(...args: DeviceRpcArgs<typeof gitRead.getGitWorkingTreeFiles>) {
    return gitRead.getGitWorkingTreeFiles(this.clientGetter, ...args);
  }

  getProjectFileIndex(...args: DeviceRpcArgs<typeof projectFiles.getProjectFileIndex>) {
    return projectFiles.getProjectFileIndex(this.clientGetter, ...args);
  }

  listProjectDirectory(...args: DeviceRpcArgs<typeof projectFiles.listProjectDirectory>) {
    return projectFiles.listProjectDirectory(this.clientGetter, ...args);
  }

  browseDirectory(...args: DeviceRpcArgs<typeof projectFiles.browseDirectory>) {
    return projectFiles.browseDirectory(this.clientGetter, ...args);
  }

  searchProjectFiles(...args: DeviceRpcArgs<typeof projectFiles.searchProjectFiles>) {
    return projectFiles.searchProjectFiles(this.clientGetter, ...args);
  }

  getLocalFilePreview(...args: DeviceRpcArgs<typeof projectFiles.getLocalFilePreview>) {
    return projectFiles.getLocalFilePreview(this.clientGetter, ...args);
  }

  copyAssetForPublish(...args: DeviceRpcArgs<typeof projectFiles.copyAssetForPublish>) {
    return projectFiles.copyAssetForPublish(this.clientGetter, ...args);
  }

  readExternalAssetForPublish(
    ...args: DeviceRpcArgs<typeof projectFiles.readExternalAssetForPublish>
  ) {
    return projectFiles.readExternalAssetForPublish(this.clientGetter, ...args);
  }

  listProjectSkills(...args: DeviceRpcArgs<typeof projectFiles.listProjectSkills>) {
    return projectFiles.listProjectSkills(this.clientGetter, ...args);
  }

  listClaudeCodeMemory(...args: DeviceRpcArgs<typeof projectFiles.listClaudeCodeMemory>) {
    return projectFiles.listClaudeCodeMemory(this.clientGetter, ...args);
  }

  listGitRemoteBranches(...args: DeviceRpcArgs<typeof gitRead.listGitRemoteBranches>) {
    return gitRead.listGitRemoteBranches(this.clientGetter, ...args);
  }

  revertGitFile(...args: DeviceRpcArgs<typeof gitWrite.revertGitFile>) {
    return gitWrite.revertGitFile(this.clientGetter, ...args);
  }

  moveProjectFiles(...args: DeviceRpcArgs<typeof projectFileMutations.moveProjectFiles>) {
    return projectFileMutations.moveProjectFiles(this.clientGetter, ...args);
  }

  renameProjectFile(...args: DeviceRpcArgs<typeof projectFileMutations.renameProjectFile>) {
    return projectFileMutations.renameProjectFile(this.clientGetter, ...args);
  }

  writeProjectFile(...args: DeviceRpcArgs<typeof projectFileMutations.writeProjectFile>) {
    return projectFileMutations.writeProjectFile(this.clientGetter, ...args);
  }

  createProjectFile(...args: DeviceRpcArgs<typeof projectFileMutations.createProjectFile>) {
    return projectFileMutations.createProjectFile(this.clientGetter, ...args);
  }

  createProjectDirectory(
    ...args: DeviceRpcArgs<typeof projectFileMutations.createProjectDirectory>
  ) {
    return projectFileMutations.createProjectDirectory(this.clientGetter, ...args);
  }

  createDirectory(...args: DeviceRpcArgs<typeof projectFileMutations.createDirectory>) {
    return projectFileMutations.createDirectory(this.clientGetter, ...args);
  }

  copyProjectFiles(...args: DeviceRpcArgs<typeof projectFileMutations.copyProjectFiles>) {
    return projectFileMutations.copyProjectFiles(this.clientGetter, ...args);
  }

  trashProjectFiles(...args: DeviceRpcArgs<typeof projectFileMutations.trashProjectFiles>) {
    return projectFileMutations.trashProjectFiles(this.clientGetter, ...args);
  }

  statPath(...args: DeviceRpcArgs<typeof workspace.statPath>) {
    return workspace.statPath(this.clientGetter, ...args);
  }

  dispatchAgentRun(...args: DeviceRpcArgs<typeof agents.dispatchAgentRun>) {
    return agents.dispatchAgentRun(this.clientGetter, ...args);
  }

  executeToolCall(...args: DeviceRpcArgs<typeof agents.executeToolCall>) {
    return agents.executeToolCall(this.clientGetter, ...args);
  }

  executeMcpCall(...args: DeviceRpcArgs<typeof agents.executeMcpCall>) {
    return agents.executeMcpCall(this.clientGetter, ...args);
  }

  executeMessageApi(...args: DeviceRpcArgs<typeof agents.executeMessageApi>) {
    return agents.executeMessageApi(this.clientGetter, ...args);
  }

  listListeningPorts(...args: DeviceRpcArgs<typeof workspace.listListeningPorts>) {
    return workspace.listListeningPorts(this.clientGetter, ...args);
  }

  getAppUpdateState(...args: DeviceRpcArgs<typeof clientUpdate.getAppUpdateState>) {
    return clientUpdate.getAppUpdateState(this.clientGetter, ...args);
  }

  checkAppUpdate(...args: DeviceRpcArgs<typeof clientUpdate.checkAppUpdate>) {
    return clientUpdate.checkAppUpdate(this.clientGetter, ...args);
  }

  installAppUpdate(...args: DeviceRpcArgs<typeof clientUpdate.installAppUpdate>) {
    return clientUpdate.installAppUpdate(this.clientGetter, ...args);
  }

  createTerminalSession(...args: DeviceRpcArgs<typeof terminal.createTerminalSession>) {
    return terminal.createTerminalSession(this.clientGetter, ...args);
  }

  writeTerminal(...args: DeviceRpcArgs<typeof terminal.writeTerminal>) {
    return terminal.writeTerminal(this.clientGetter, ...args);
  }

  readTerminal(...args: DeviceRpcArgs<typeof terminal.readTerminal>) {
    return terminal.readTerminal(this.clientGetter, ...args);
  }

  resizeTerminal(...args: DeviceRpcArgs<typeof terminal.resizeTerminal>) {
    return terminal.resizeTerminal(this.clientGetter, ...args);
  }

  closeTerminal(...args: DeviceRpcArgs<typeof terminal.closeTerminal>) {
    return terminal.closeTerminal(this.clientGetter, ...args);
  }

  getCliUpdateState(...args: DeviceRpcArgs<typeof clientUpdate.getCliUpdateState>) {
    return clientUpdate.getCliUpdateState(this.clientGetter, ...args);
  }

  checkCliUpdate(...args: DeviceRpcArgs<typeof clientUpdate.checkCliUpdate>) {
    return clientUpdate.checkCliUpdate(this.clientGetter, ...args);
  }

  restartCli(...args: DeviceRpcArgs<typeof clientUpdate.restartCli>) {
    return clientUpdate.restartCli(this.clientGetter, ...args);
  }

  private getClient(): GatewayHttpClient | null {
    const url = gatewayEnv.DEVICE_GATEWAY_URL;
    const token = gatewayEnv.DEVICE_GATEWAY_SERVICE_TOKEN;
    if (!url || !token) return null;

    if (!this.client) {
      this.client = new GatewayHttpClient({
        gatewayUrl: url,
        resolveClientKinds: resolveDeviceClientKinds,
        serviceToken: token,
      });
    }
    return this.client;
  }
}

export const deviceGateway = new DeviceGateway();
