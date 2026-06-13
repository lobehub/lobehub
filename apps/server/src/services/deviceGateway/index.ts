import { type DeviceAttachment } from '@lobechat/builtin-tool-remote-device';
import {
  type DeviceMessageApiResult,
  type DeviceStatusResult,
  type DeviceSystemInfo,
  type DeviceToolCallResult,
  GatewayHttpClient,
  type GatewayMcpStdioParams,
} from '@lobechat/device-gateway-client';
import type { HeterogeneousAgentType } from '@lobechat/heterogeneous-agents';
import type {
  DeviceGitAheadBehind,
  DeviceGitBranchDiffPatches,
  DeviceGitBranchInfo,
  DeviceGitBranchListItem,
  DeviceGitCheckoutResult,
  DeviceGitDeleteBranchResult,
  DeviceGitFileRevertResult,
  DeviceGitLinkedPullRequestResult,
  DeviceGitRemoteBranchListItem,
  DeviceGitRenameBranchResult,
  DeviceGitSyncResult,
  DeviceGitWorkingTreeFiles,
  DeviceGitWorkingTreePatches,
  DeviceGitWorkingTreeStatus,
  DeviceListProjectSkillsResult,
  DeviceLocalFilePreviewResult,
  DeviceProjectFileIndexResult,
  ProjectSkillMeta,
  WorkspaceInitResult,
} from '@lobechat/types';
import debug from 'debug';

import { gatewayEnv } from '@/envs/gateway';

const log = debug('lobe-server:device-gateway');

export type { DeviceAttachment, DeviceStatusResult, DeviceSystemInfo };

export class DeviceGateway {
  private client: GatewayHttpClient | null = null;

  get isConfigured(): boolean {
    return !!gatewayEnv.DEVICE_GATEWAY_URL;
  }

  async queryDeviceStatus(userId: string): Promise<DeviceStatusResult> {
    const client = this.getClient();
    if (!client) return { deviceCount: 0, online: false };

    try {
      return await client.queryDeviceStatus(userId);
    } catch {
      return { deviceCount: 0, online: false };
    }
  }

  async queryDeviceList(userId: string): Promise<DeviceAttachment[]> {
    const client = this.getClient();
    if (!client) return [];

    try {
      const devices = await client.queryDeviceList(userId);
      // The gateway already dedupes to one entry per physical device, with its
      // live connections nested as `channels`. Map to the runtime shape; every
      // returned device has at least one channel, so it's online.
      return devices.map((d) => ({
        // `channels` may be absent if the gateway worker deploy lags behind the
        // server (separate Cloudflare deploy); tolerate the legacy flat shape.
        channels: (d.channels ?? []).map((c) => ({
          channel: c.channel,
          connectedAt: new Date(c.connectedAt).toISOString(),
          connectionId: c.connectionId,
        })),
        deviceId: d.deviceId,
        hostname: d.hostname,
        lastSeen: new Date(d.connectedAt).toISOString(),
        online: true,
        platform: d.platform,
      }));
    } catch {
      return [];
    }
  }

  async queryDeviceSystemInfo(
    userId: string,
    deviceId: string,
  ): Promise<DeviceSystemInfo | undefined> {
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.getDeviceSystemInfo(userId, deviceId);
      return result.success ? result.systemInfo : undefined;
    } catch {
      log('queryDeviceSystemInfo: failed for userId=%s, deviceId=%s', userId, deviceId);
      return undefined;
    }
  }

  /**
   * Scan a bound project directory on the device in a single round-trip:
   * project skills (`.agents/skills` + `.claude/skills`) plus the root
   * `AGENTS.md` / `CLAUDE.md`. Routed through the generic device RPC relay
   * (`invokeRpc`) — a server-internal channel the agent never sees, distinct
   * from the LLM-facing tool-call path.
   *
   * Returns `undefined` when the gateway is unconfigured, the device is offline,
   * or the call fails — callers fall back to the cached scan.
   */
  async initWorkspace(params: {
    deviceId: string;
    scope: string;
    timeout?: number;
    userId: string;
  }): Promise<WorkspaceInitResult | undefined> {
    const { userId, deviceId, scope, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      // The device returns rich `ProjectSkillItem`s; narrow to metadata only so
      // the cached `workingDirs` payload stays small (SKILL.md bodies are still
      // read lazily at activation time).
      const result = await client.invokeRpc<{
        instructions?: WorkspaceInitResult['instructions'];
        skills?: (ProjectSkillMeta & Record<string, unknown>)[];
      }>({ deviceId, timeout, userId }, { method: 'initWorkspace', params: { scope } });

      if (!result.success || !result.data) {
        log('initWorkspace: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      const { instructions, skills } = result.data;
      return {
        instructions: instructions ?? [],
        skills: (skills ?? []).map(({ description, name, path }) => ({
          description,
          name,
          path,
        })),
      };
    } catch (error) {
      log('initWorkspace: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /**
   * Generic helper for the granular git read RPCs (branch / PR / working-tree /
   * ahead-behind). Returns `undefined` when the gateway is unconfigured, the
   * device is offline, or the call fails — callers treat that as "unknown".
   */
  private async invokeGitRead<T>(
    method: string,
    params: { deviceId: string; timeout?: number; userId: string },
    rpcParams: Record<string, unknown>,
  ): Promise<T | undefined> {
    const { userId, deviceId, timeout = 15_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<T>(
        { deviceId, timeout, userId },
        { method, params: rpcParams },
      );

      if (!result.success || result.data === undefined) {
        log('%s: failed for deviceId=%s — %s', method, deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('%s: error for deviceId=%s — %O', method, deviceId, error);
      return undefined;
    }
  }

  /** Branch name + detached flag for a directory on a remote device. */
  gitBranch(params: { deviceId: string; path: string; userId: string }) {
    return this.invokeGitRead<DeviceGitBranchInfo>('getGitBranch', params, { path: params.path });
  }

  /** The GitHub PR linked to a branch in a directory on a remote device. */
  gitLinkedPullRequest(params: { branch: string; deviceId: string; path: string; userId: string }) {
    return this.invokeGitRead<DeviceGitLinkedPullRequestResult>('getLinkedPullRequest', params, {
      branch: params.branch,
      path: params.path,
    });
  }

  /** Working-tree dirty-file counts for a directory on a remote device. */
  gitWorkingTreeStatus(params: { deviceId: string; path: string; userId: string }) {
    return this.invokeGitRead<DeviceGitWorkingTreeStatus>('getGitWorkingTreeStatus', params, {
      path: params.path,
    });
  }

  /** Ahead/behind commit counts for a directory on a remote device. */
  gitAheadBehind(params: { deviceId: string; path: string; userId: string }) {
    return this.invokeGitRead<DeviceGitAheadBehind>('getGitAheadBehind', params, {
      path: params.path,
    });
  }

  /**
   * List the local branches of a directory on a remote device via the
   * `listGitBranches` device RPC, so the web/remote branch switcher can populate
   * the same dropdown the local desktop renders over IPC.
   */
  async listGitBranches(params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitBranchListItem[] | undefined> {
    const { userId, deviceId, path, timeout = 15_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceGitBranchListItem[]>(
        { deviceId, timeout, userId },
        { method: 'listGitBranches', params: { path } },
      );

      if (!result.success || !result.data) {
        log('listGitBranches: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('listGitBranches: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /**
   * Checkout (or create) a branch in a directory on a remote device via the
   * `checkoutGitBranch` device RPC.
   */
  async checkoutGitBranch(params: {
    branch: string;
    create?: boolean;
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitCheckoutResult> {
    const { userId, deviceId, branch, create, path, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return { error: 'Device gateway not configured', success: false };

    try {
      const result = await client.invokeRpc<DeviceGitCheckoutResult>(
        { deviceId, timeout, userId },
        { method: 'checkoutGitBranch', params: { branch, create, path } },
      );

      if (!result.success || !result.data) {
        log('checkoutGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
        return { error: result.error || 'Checkout failed', success: false };
      }

      return result.data;
    } catch (error) {
      log('checkoutGitBranch: error for deviceId=%s — %O', deviceId, error);
      return { error: (error as Error)?.message || 'Checkout failed', success: false };
    }
  }

  /**
   * Rename a branch in a directory on a remote device via the `renameGitBranch`
   * device RPC.
   */
  async renameGitBranch(params: {
    deviceId: string;
    from: string;
    path: string;
    timeout?: number;
    to: string;
    userId: string;
  }): Promise<DeviceGitRenameBranchResult> {
    const { userId, deviceId, from, to, path, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return { error: 'Device gateway not configured', success: false };

    try {
      const result = await client.invokeRpc<DeviceGitRenameBranchResult>(
        { deviceId, timeout, userId },
        { method: 'renameGitBranch', params: { from, path, to } },
      );

      if (!result.success || !result.data) {
        log('renameGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
        return { error: result.error || 'Rename failed', success: false };
      }

      return result.data;
    } catch (error) {
      log('renameGitBranch: error for deviceId=%s — %O', deviceId, error);
      return { error: (error as Error)?.message || 'Rename failed', success: false };
    }
  }

  /**
   * Delete a branch in a directory on a remote device via the `deleteGitBranch`
   * device RPC.
   */
  async deleteGitBranch(params: {
    branch: string;
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitDeleteBranchResult> {
    const { userId, deviceId, branch, path, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return { error: 'Device gateway not configured', success: false };

    try {
      const result = await client.invokeRpc<DeviceGitDeleteBranchResult>(
        { deviceId, timeout, userId },
        { method: 'deleteGitBranch', params: { branch, path } },
      );

      if (!result.success || !result.data) {
        log('deleteGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
        return { error: result.error || 'Delete failed', success: false };
      }

      return result.data;
    } catch (error) {
      log('deleteGitBranch: error for deviceId=%s — %O', deviceId, error);
      return { error: (error as Error)?.message || 'Delete failed', success: false };
    }
  }

  /**
   * Pull (`--ff-only`) the current branch of a directory on a remote device via
   * the `pullGitBranch` device RPC.
   */
  async pullGitBranch(params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitSyncResult> {
    const { userId, deviceId, path, timeout = 65_000 } = params;
    const client = this.getClient();
    if (!client) return { error: 'Device gateway not configured', success: false };

    try {
      const result = await client.invokeRpc<DeviceGitSyncResult>(
        { deviceId, timeout, userId },
        { method: 'pullGitBranch', params: { path } },
      );

      if (!result.success || !result.data) {
        log('pullGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
        return { error: result.error || 'Pull failed', success: false };
      }

      return result.data;
    } catch (error) {
      log('pullGitBranch: error for deviceId=%s — %O', deviceId, error);
      return { error: (error as Error)?.message || 'Pull failed', success: false };
    }
  }

  /**
   * Push the current branch of a directory on a remote device via the
   * `pushGitBranch` device RPC.
   */
  async pushGitBranch(params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitSyncResult> {
    const { userId, deviceId, path, timeout = 65_000 } = params;
    const client = this.getClient();
    if (!client) return { error: 'Device gateway not configured', success: false };

    try {
      const result = await client.invokeRpc<DeviceGitSyncResult>(
        { deviceId, timeout, userId },
        { method: 'pushGitBranch', params: { path } },
      );

      if (!result.success || !result.data) {
        log('pushGitBranch: failed for deviceId=%s — %s', deviceId, result.error);
        return { error: result.error || 'Push failed', success: false };
      }

      return result.data;
    } catch (error) {
      log('pushGitBranch: error for deviceId=%s — %O', deviceId, error);
      return { error: (error as Error)?.message || 'Push failed', success: false };
    }
  }

  /**
   * Working-tree (unstaged) per-file patches for a directory on a remote device
   * via the `getGitWorkingTreePatches` device RPC, so the web/remote Review panel
   * renders the same diffs the local desktop shows over IPC.
   */
  async getGitWorkingTreePatches(params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitWorkingTreePatches | undefined> {
    const { userId, deviceId, path, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceGitWorkingTreePatches>(
        { deviceId, timeout, userId },
        { method: 'getGitWorkingTreePatches', params: { path } },
      );

      if (!result.success || !result.data) {
        log('getGitWorkingTreePatches: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('getGitWorkingTreePatches: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /**
   * Branch diff (current branch vs base ref) per-file patches for a directory on
   * a remote device via the `getGitBranchDiff` device RPC.
   */
  async getGitBranchDiff(params: {
    baseRef?: string;
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitBranchDiffPatches | undefined> {
    const { userId, deviceId, baseRef, path, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceGitBranchDiffPatches>(
        { deviceId, timeout, userId },
        { method: 'getGitBranchDiff', params: { baseRef, path } },
      );

      if (!result.success || !result.data) {
        log('getGitBranchDiff: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('getGitBranchDiff: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /**
   * Repo-relative paths of dirty working-tree files for a directory on a remote
   * device via the `getGitWorkingTreeFiles` device RPC — the Files tab's git
   * status overlay.
   */
  async getGitWorkingTreeFiles(params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitWorkingTreeFiles | undefined> {
    const { userId, deviceId, path, timeout = 15_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceGitWorkingTreeFiles>(
        { deviceId, timeout, userId },
        { method: 'getGitWorkingTreeFiles', params: { path } },
      );

      if (!result.success || !result.data) {
        log('getGitWorkingTreeFiles: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('getGitWorkingTreeFiles: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /**
   * Project file index (tree) for a directory on a remote device via the
   * `getProjectFileIndex` device RPC — the Files tab's tree.
   */
  async getProjectFileIndex(params: {
    deviceId: string;
    scope: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceProjectFileIndexResult | undefined> {
    const { userId, deviceId, scope, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceProjectFileIndexResult>(
        { deviceId, timeout, userId },
        { method: 'getProjectFileIndex', params: { scope } },
      );

      if (!result.success || !result.data) {
        log('getProjectFileIndex: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('getProjectFileIndex: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /**
   * Read a preview payload for a file on a remote device. This is read-only and
   * deliberately mirrors the desktop local-file preview contract without
   * exposing a `localfile://` URL to web callers.
   */
  async getLocalFilePreview(params: {
    accept?: 'image';
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
    workingDirectory: string;
  }): Promise<DeviceLocalFilePreviewResult> {
    const { accept, userId, deviceId, path, workingDirectory, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return { error: 'Device gateway not configured', success: false };

    try {
      const result = await client.invokeRpc<DeviceLocalFilePreviewResult>(
        { deviceId, timeout, userId },
        {
          method: 'getLocalFilePreview',
          params: { accept, path, workingDirectory },
        },
      );

      if (!result.success || !result.data) {
        log('getLocalFilePreview: failed for deviceId=%s — %s', deviceId, result.error);
        return { error: result.error || 'Failed to load local file preview', success: false };
      }

      return result.data;
    } catch (error) {
      log('getLocalFilePreview: error for deviceId=%s — %O', deviceId, error);
      return { error: (error as Error).message, success: false };
    }
  }

  /**
   * Project skills (`.agents/skills` / `.claude/skills`) for a directory on a
   * remote device via the `listProjectSkills` device RPC — the Resources tab's
   * skills group in device mode. Mirrors `getProjectFileIndex`; returns
   * `undefined` when the gateway is unconfigured, the device is offline, or the
   * call fails so the UI degrades to "no skills".
   */
  async listProjectSkills(params: {
    deviceId: string;
    scope: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceListProjectSkillsResult | undefined> {
    const { userId, deviceId, scope, timeout = 30_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceListProjectSkillsResult>(
        { deviceId, timeout, userId },
        { method: 'listProjectSkills', params: { scope } },
      );

      if (!result.success || !result.data) {
        log('listProjectSkills: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('listProjectSkills: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /**
   * List the remote branches (`refs/remotes/origin/*`) of a directory on a
   * remote device via the `listGitRemoteBranches` device RPC, so the web/remote
   * Review base-ref picker mirrors the local desktop's.
   */
  async listGitRemoteBranches(params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitRemoteBranchListItem[] | undefined> {
    const { userId, deviceId, path, timeout = 15_000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceGitRemoteBranchListItem[]>(
        { deviceId, timeout, userId },
        { method: 'listGitRemoteBranches', params: { path } },
      );

      if (!result.success || !result.data) {
        log('listGitRemoteBranches: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('listGitRemoteBranches: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  /**
   * Revert (discard working-tree changes to) a single file in a directory on a
   * remote device via the `revertGitFile` device RPC.
   */
  async revertGitFile(params: {
    deviceId: string;
    filePath: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<DeviceGitFileRevertResult> {
    const { userId, deviceId, filePath, path, timeout = 15_000 } = params;
    const client = this.getClient();
    if (!client) return { error: 'Device gateway not configured', success: false };

    try {
      const result = await client.invokeRpc<DeviceGitFileRevertResult>(
        { deviceId, timeout, userId },
        { method: 'revertGitFile', params: { filePath, path } },
      );

      if (!result.success || !result.data) {
        log('revertGitFile: failed for deviceId=%s — %s', deviceId, result.error);
        return { error: result.error || 'Revert failed', success: false };
      }

      return result.data;
    } catch (error) {
      log('revertGitFile: error for deviceId=%s — %O', deviceId, error);
      return { error: (error as Error)?.message || 'Revert failed', success: false };
    }
  }

  /**
   * Check whether a path exists on the device and is a directory, via the same
   * generic `invokeRpc` channel as `gitInfo`. Lets a web / remote client
   * validate a manually-entered working directory before binding it. Returns
   * `undefined` when the gateway is unconfigured or the device is unreachable
   * (the caller treats "can't verify" as non-blocking).
   */
  async statPath(params: {
    deviceId: string;
    path: string;
    timeout?: number;
    userId: string;
  }): Promise<{ exists: boolean; isDirectory: boolean; repoType?: 'git' | 'github' } | undefined> {
    const { userId, deviceId, path, timeout = 8000 } = params;
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<{
        exists: boolean;
        isDirectory: boolean;
        repoType?: 'git' | 'github';
      }>({ deviceId, timeout, userId }, { method: 'statPath', params: { path } });

      if (!result.success || !result.data) {
        log('statPath: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('statPath: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  async dispatchAgentRun(params: {
    agentType: HeterogeneousAgentType;
    cwd?: string;
    deviceId?: string;
    /** Image attachments forwarded to the device as fetchable (signed) URLs. */
    imageList?: Array<{ id?: string; url: string }>;
    jwt: string;
    operationId: string;
    prompt: string;
    resumeSessionId?: string;
    systemContext?: string;
    topicId: string;
    userId: string;
  }): Promise<{ error?: string; success: boolean }> {
    const client = this.getClient();
    if (!client) return { error: 'GATEWAY_NOT_CONFIGURED', success: false };

    try {
      return await client.dispatchAgentRun(params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('dispatchAgentRun: error — %s', message);
      return { error: message, success: false };
    }
  }

  async executeToolCall(
    params: { deviceId: string; userId: string },
    toolCall: { apiName: string; arguments: string; identifier: string },
    timeout = 30_000,
  ): Promise<DeviceToolCallResult> {
    const client = this.getClient();
    if (!client) {
      return {
        content: 'Device Gateway is not configured',
        error: 'GATEWAY_NOT_CONFIGURED',
        success: false,
      };
    }

    log(
      'executeToolCall: userId=%s, deviceId=%s, tool=%s/%s',
      params.userId,
      params.deviceId,
      toolCall.identifier,
      toolCall.apiName,
    );

    try {
      return await client.executeToolCall(
        { deviceId: params.deviceId, timeout, userId: params.userId },
        toolCall,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('executeToolCall: error — %s', message);
      return { content: `Device tool call error: ${message}`, error: message, success: false };
    }
  }

  /**
   * Tunnel a stdio MCP tool call to a connected device. The cloud server can't
   * spawn the user's local MCP binary, so the command/args/env are forwarded
   * to the device, which spawns the stdio server and runs the call locally.
   */
  async executeMcpCall(
    mcpCall: {
      apiName: string;
      arguments: string;
      deviceId: string;
      identifier: string;
      params: GatewayMcpStdioParams;
      userId: string;
    },
    timeout = 30_000,
  ): Promise<DeviceToolCallResult> {
    const client = this.getClient();
    if (!client) {
      return {
        content: 'Device Gateway is not configured',
        error: 'GATEWAY_NOT_CONFIGURED',
        success: false,
      };
    }

    log(
      'executeMcpCall: userId=%s, deviceId=%s, mcp=%s/%s',
      mcpCall.userId,
      mcpCall.deviceId,
      mcpCall.identifier,
      mcpCall.apiName,
    );

    try {
      return await client.executeMcpCall({ ...mcpCall, timeout });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('executeMcpCall: error — %s', message);
      return { content: `Device MCP call error: ${message}`, error: message, success: false };
    }
  }

  async executeMessageApi(
    params: { deviceId: string; userId: string },
    api: { apiName: string; payload: Record<string, unknown>; platform: string },
    timeout = 30_000,
  ): Promise<DeviceMessageApiResult> {
    const client = this.getClient();
    if (!client) {
      return {
        content: 'Device Gateway is not configured',
        error: 'GATEWAY_NOT_CONFIGURED',
        success: false,
      };
    }

    log(
      'executeMessageApi: userId=%s, deviceId=%s, api=%s/%s',
      params.userId,
      params.deviceId,
      api.platform,
      api.apiName,
    );

    try {
      return await client.executeMessageApi(
        { deviceId: params.deviceId, timeout, userId: params.userId },
        api,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('executeMessageApi: error — %s', message);
      return { content: `Device message API error: ${message}`, error: message, success: false };
    }
  }

  private getClient(): GatewayHttpClient | null {
    const url = gatewayEnv.DEVICE_GATEWAY_URL;
    const token = gatewayEnv.DEVICE_GATEWAY_SERVICE_TOKEN;
    if (!url || !token) return null;

    if (!this.client) {
      this.client = new GatewayHttpClient({ gatewayUrl: url, serviceToken: token });
    }
    return this.client;
  }
}

export const deviceGateway = new DeviceGateway();
