import type { DeviceAttachment, DeviceSystemInfo } from './types';

export interface DeviceStatusResult {
  deviceCount: number;
  online: boolean;
}

export interface DeviceToolCallResult {
  content: string;
  error?: string;
  success: boolean;
}

export interface GatewayHttpClientOptions {
  gatewayUrl: string;
  serviceToken: string;
}

export class GatewayHttpClient {
  private gatewayUrl: string;
  private serviceToken: string;

  constructor(options: GatewayHttpClientOptions) {
    this.gatewayUrl = options.gatewayUrl;
    this.serviceToken = options.serviceToken;
  }

  async queryDeviceStatus(userId: string): Promise<DeviceStatusResult> {
    const res = await this.post('/api/device/status', { userId });
    if (!res.ok) return { deviceCount: 0, online: false };

    const data = await res.json();
    return {
      deviceCount: data.deviceCount ?? 0,
      online: data.online ?? false,
    };
  }

  async queryDeviceList(userId: string): Promise<DeviceAttachment[]> {
    const res = await this.post('/api/device/devices', { userId });
    if (!res.ok) return [];

    const data = await res.json();
    return Array.isArray(data.devices) ? data.devices : [];
  }

  async executeToolCall(
    params: { deviceId?: string; timeout?: number; userId: string },
    toolCall: { apiName: string; arguments: string; identifier: string },
  ): Promise<DeviceToolCallResult> {
    const res = await this.post('/api/device/tool-call', {
      deviceId: params.deviceId,
      timeout: params.timeout,
      toolCall,
      userId: params.userId,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        content: `Device tool call failed (HTTP ${res.status})`,
        error: text || `HTTP ${res.status}`,
        success: false,
      };
    }

    const data = await res.json();
    return {
      content:
        typeof data.content === 'string' ? data.content : JSON.stringify(data.content ?? data),
      error: data.error,
      success: data.success ?? true,
    };
  }

  async getDeviceSystemInfo(
    userId: string,
    deviceId: string,
  ): Promise<{ success: boolean; systemInfo?: DeviceSystemInfo }> {
    const res = await this.post('/api/device/system-info', { deviceId, userId });
    if (!res.ok) {
      return { success: false };
    }

    const data = await res.json();
    return {
      success: data.success ?? false,
      systemInfo: data.systemInfo,
    };
  }

  private post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.gatewayUrl}${path}`, {
      body: JSON.stringify(body),
      headers: {
        'Authorization': `Bearer ${this.serviceToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
  }
}
