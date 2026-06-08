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
import type { DeviceGitInfo, ProjectSkillMeta, WorkspaceInitResult } from '@lobechat/types';
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
  async initWorkspace(
    userId: string,
    deviceId: string,
    scope: string,
    timeout = 30_000,
  ): Promise<WorkspaceInitResult | undefined> {
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
   * Fetch git status (branch / file changes / PR) for a directory on a remote
   * device, via the same generic `invokeRpc` channel as `initWorkspace`. Lets
   * the UI render a remote device's git the same as the local desktop.
   */
  async gitInfo(
    userId: string,
    deviceId: string,
    scope: string,
    isGithub = false,
    timeout = 15_000,
  ): Promise<DeviceGitInfo | undefined> {
    const client = this.getClient();
    if (!client) return undefined;

    try {
      const result = await client.invokeRpc<DeviceGitInfo>(
        { deviceId, timeout, userId },
        { method: 'gitInfo', params: { isGithub, scope } },
      );

      if (!result.success || !result.data) {
        log('gitInfo: failed for deviceId=%s — %s', deviceId, result.error);
        return undefined;
      }

      return result.data;
    } catch (error) {
      log('gitInfo: error for deviceId=%s — %O', deviceId, error);
      return undefined;
    }
  }

  async dispatchAgentRun(params: {
    agentType: HeterogeneousAgentType;
    cwd?: string;
    deviceId?: string;
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
