import type { DeviceSystemInfo, GatewayDevice } from './types';

const DEFAULT_GATEWAY_TOOL_CALL_TIMEOUT_MS = 30_000;
const HTTP_CALL_TIMEOUT_PADDING_MS = 30_000;

export interface DeviceStatusResult {
  deviceCount: number;
  online: boolean;
}

export interface DeviceToolCallResult {
  content: string;
  error?: string;
  state?: unknown;
  success: boolean;
}

export interface DeviceMessageApiResult {
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

  async queryDeviceList(userId: string): Promise<GatewayDevice[]> {
    const res = await this.post('/api/device/devices', { userId });
    if (!res.ok) return [];

    const data = await res.json();
    return Array.isArray(data.devices) ? data.devices : [];
  }

  async executeToolCall(
    params: { deviceId?: string; timeout?: number; userId: string },
    toolCall: { apiName: string; arguments: string; identifier: string },
  ): Promise<DeviceToolCallResult> {
    const timeout =
      typeof params.timeout === 'number' && Number.isFinite(params.timeout)
        ? Math.max(Math.trunc(params.timeout), 0)
        : DEFAULT_GATEWAY_TOOL_CALL_TIMEOUT_MS;
    const res = await this.post(
      '/api/device/tool-call',
      {
        deviceId: params.deviceId,
        timeout: params.timeout,
        toolCall,
        userId: params.userId,
      },
      { timeout: timeout + HTTP_CALL_TIMEOUT_PADDING_MS },
    );

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
      // Device sends a typed envelope ({ content, state, success }). The legacy
      // fallback used to JSON.stringify `data.content ?? data` — when content
      // was missing it would stringify the *entire response body* including
      // `success` and any other top-level fields, which leaked the structured
      // payload into the LLM-facing content string. Only stringify the
      // `content` field itself; never fall back to the whole body.
      content:
        typeof data.content === 'string'
          ? data.content
          : data.content !== undefined && data.content !== null
            ? JSON.stringify(data.content)
            : typeof data.error === 'string'
              ? data.error
              : '',
      error: data.error,
      state: data.state,
      success: data.success ?? true,
    };
  }

  async executeMessageApi(
    params: { deviceId?: string; timeout?: number; userId: string },
    api: { apiName: string; payload: Record<string, unknown>; platform: string },
  ): Promise<DeviceMessageApiResult> {
    const res = await this.post('/api/device/message-api', {
      api,
      deviceId: params.deviceId,
      timeout: params.timeout,
      userId: params.userId,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        content: `Device message API call failed (HTTP ${res.status})`,
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

  async dispatchAgentRun(params: {
    agentType: string;
    cwd?: string;
    deviceId?: string;
    jwt: string;
    operationId: string;
    prompt: string;
    resumeSessionId?: string;
    systemContext?: string;
    timeout?: number;
    topicId: string;
    userId: string;
  }): Promise<{ success: boolean; error?: string }> {
    const res = await this.post('/api/device/agent/run', params);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: text || `HTTP ${res.status}`, success: false };
    }
    return { success: true };
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

  private post(path: string, body: unknown, options?: { timeout?: number }): Promise<Response> {
    return fetch(`${this.gatewayUrl}${path}`, {
      body: JSON.stringify(body),
      headers: {
        'Authorization': `Bearer ${this.serviceToken}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      ...(options?.timeout ? { signal: AbortSignal.timeout(options.timeout) } : {}),
    });
  }
}
