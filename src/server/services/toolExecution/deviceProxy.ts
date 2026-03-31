import { type DeviceAttachment } from '@lobechat/builtin-tool-remote-device';
import {
  type DeviceStatusResult,
  type DeviceSystemInfo,
  GatewayHttpClient,
} from '@lobechat/device-gateway-client';
import debug from 'debug';

import { gatewayEnv } from '@/envs/gateway';

const log = debug('lobe-server:device-proxy');

export type { DeviceAttachment, DeviceStatusResult, DeviceSystemInfo };

export class DeviceProxy {
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
      // Transform gateway format to runtime-expected format
      // All devices from gateway have active WebSocket connections, so they're online
      return devices.map((d) => ({
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

  async executeToolCall(
    params: { deviceId: string; userId: string },
    toolCall: { apiName: string; arguments: string; identifier: string },
    timeout = 30_000,
  ): Promise<{ content: string; error?: string; success: boolean }> {
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

export const deviceProxy = new DeviceProxy();
