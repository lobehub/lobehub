import type {
  DeviceClient,
  DeviceMetricSample,
  GatewayDispatchEnvelope,
  GatewayDispatchResult,
  GatewayExecutionAction,
  GatewayExecutionEnvelope,
  GatewayPrincipal,
} from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import { strictGatewayUrl } from '../../agent-gateway-client/src/tenancy';
import {
  describeGatewayRequestFailure,
  describeGatewayResponseFailure,
  DeviceDispatchSettlementError,
  DeviceExecutionUnknownError,
  type DeviceTransportFailure,
  type DeviceUnavailableErrorData,
} from './deviceTransportError';
import type {
  DeviceSystemInfo,
  GatewayDevice,
  GatewayMcpParams,
  GatewayToolCallType,
  GatewayTunnelRegistration,
} from './types';

const DEFAULT_GATEWAY_TOOL_CALL_TIMEOUT_MS = 30_000;
/**
 * Device *reads* are on the critical path of every routing decision, and `post`
 * has no deadline of its own — an unanswered read would otherwise hang for as
 * long as the socket stays open.
 */
const DEVICE_QUERY_TIMEOUT_MS = 10_000;
const TENANT_ID_PATTERN = /^[\w.:-]{1,128}$/;
const HTTP_CALL_TIMEOUT_PADDING_MS = 30_000;
/**
 * The gateway holds an undelivered tool call for `timeout` plus a recovery
 * window (45s) waiting for the device to reconnect, then answers 503
 * `DEVICE_OFFLINE` — "never ran, safe to retry". A client deadline shorter than
 * that window aborts first, so an offline device always read as "timed out, the
 * work may still be running". Keep this above the gateway's window.
 */
const TOOL_CALL_HTTP_TIMEOUT_PADDING_MS = 60_000;
/**
 * The padding must not stretch a call past the agent function window (800s,
 * the server's tool-timeout ceiling): an invocation killed mid-wait normalizes
 * nothing at all. Near the ceiling the offline answer is given up instead.
 */
const TOOL_CALL_HTTP_DEADLINE_CAP_MS = 800_000;

export interface DeviceStatusResult {
  deviceCount: number;
  online: boolean;
}

/** Result envelope returned by a tunneled device tool call. */
export interface DeviceToolCallResult {
  content: string;
  error?: string;
  /** Structured availability context for callers that can choose whether to retry. */
  errorData?: DeviceUnavailableErrorData;
  /** The request may have reached the device, but no terminal response was observed. */
  executionUnknown?: boolean;
  state?: unknown;
  success: boolean;
}

/** Result envelope returned by a tunneled device messaging call. */
export interface DeviceMessageApiResult {
  content: string;
  error?: string;
  /** Structured availability context for callers that can choose whether to retry. */
  errorData?: DeviceUnavailableErrorData;
  success: boolean;
}

/**
 * Result envelope returned by a generic device RPC.
 *
 * @param T Successful RPC payload type.
 */
export interface DeviceRpcResult<T = unknown> {
  data?: T;
  error?: string;
  /** Structured availability context for callers that can choose whether to retry. */
  errorData?: DeviceUnavailableErrorData;
  success: boolean;
}

/** Shape a described transport failure into the LLM-facing tool result. */
const toFailedToolCallResult = (failure: DeviceTransportFailure): DeviceToolCallResult => ({
  content: failure.content,
  error: failure.error,
  ...(failure.data ? { errorData: failure.data } : {}),
  ...(failure.executionUnknown ? { executionUnknown: true } : {}),
  success: false,
});

/** What a request asks a device to do, for choosing which client may serve it. */
export type GatewayDispatchTarget =
  | { identifier: string; kind: 'tool'; type: GatewayToolCallType }
  | { kind: 'messageApi'; platform: string }
  | { kind: 'rpc'; method: string };

export interface GatewayHttpClientOptions {
  execution?: GatewayExecutionEnvelope;
  gatewayUrl: string;
  prepareDispatch?: (input: {
    action: GatewayExecutionAction;
    operationId?: string;
    resourceId: string;
    targetPrincipal: GatewayPrincipal;
  }) => Promise<GatewayDispatchEnvelope>;
  /**
   * Which device clients can serve a request, sent to the gateway as
   * `clientKinds` so it skips connections of other clients (one device can
   * hold the desktop app and `lh connect` at once). Return `undefined` when
   * any client can. A gateway that predates `clientKinds` ignores it.
   */
  resolveClientKinds?: (target: GatewayDispatchTarget) => DeviceClient[] | undefined;
  serviceToken: string;
  /** Trusted Work settlement must finish before the business result is exposed. */
  settleDispatch?: (input: {
    envelope: GatewayDispatchEnvelope;
    reply: GatewayDispatchResult;
  }) => Promise<void>;
  tenantId?: string;
}

export class GatewayHttpClient {
  private readonly options: GatewayHttpClientOptions;
  private gatewayUrl: string;
  private resolveClientKinds?: GatewayHttpClientOptions['resolveClientKinds'];
  private serviceToken: string;

  constructor(options: GatewayHttpClientOptions) {
    this.options = options;
    this.gatewayUrl = options.gatewayUrl;
    this.resolveClientKinds = options.resolveClientKinds;
    this.serviceToken = options.serviceToken;
  }

  async queryDeviceStatus(userId: string, workspaceId?: string): Promise<DeviceStatusResult> {
    const res = await this.request('/api/device/status', 'GET', { userId, workspaceId });
    // A gateway that answered with an error did not tell us "nothing is
    // online" — it told us nothing. Reporting the two as the same value is how
    // a transient 5xx became an authoritative "all devices offline" downstream.
    if (!res.ok) throw new Error(`Device gateway /api/device/status responded ${res.status}`);

    const data = await res.json();
    return {
      deviceCount: data.deviceCount ?? 0,
      online: data.online ?? false,
    };
  }

  async queryDeviceList(userId: string, workspaceId?: string): Promise<GatewayDevice[]> {
    const res = await this.request('/api/device/devices', 'GET', { userId, workspaceId });
    // See `queryDeviceStatus`: an errored read is an UNKNOWN online set, and
    // only the caller can decide what to do about that.
    if (!res.ok) throw new Error(`Device gateway /api/device/devices responded ${res.status}`);

    const data = await res.json();
    return Array.isArray(data.devices) ? data.devices : [];
  }

  async executeToolCall(
    params: {
      /**
       * The device clients that may serve this call, when the caller already
       * knows; otherwise `resolveClientKinds` decides from the tool identifier.
       */
      clientKinds?: DeviceClient[];
      deviceId?: string;
      operationId?: string;
      timeout?: number;
      userId: string;
      workspaceId?: string;
    },
    toolCall: { apiName: string; arguments: string; identifier: string },
  ): Promise<DeviceToolCallResult> {
    return this.postToolCall(params, { ...toolCall, type: 'tool' });
  }

  /**
   * Tunnel an MCP tool call to the device. Rides the same
   * `/api/device/tool-call` relay as {@link executeToolCall} — the gateway
   * forwards `toolCall` opaquely — but carries `params` (the MCP connection
   * params) so the device routes it to its local MCP client rather than the
   * builtin local-system tool switch. Used when only the device can reach the
   * MCP server: stdio (the cloud can't spawn the user's binary) and
   * localhost / LAN HTTP endpoints (the cloud's fetch can't reach them).
   */
  async executeMcpCall(mcpCall: {
    apiName: string;
    arguments: string;
    deviceId?: string;
    identifier: string;
    params: GatewayMcpParams;
    timeout?: number;
    userId: string;
    workspaceId?: string;
  }): Promise<DeviceToolCallResult> {
    const { deviceId, timeout, userId, workspaceId, ...toolCall } = mcpCall;
    return this.postToolCall(
      { deviceId, timeout, userId, workspaceId },
      { ...toolCall, type: 'mcp' },
    );
  }

  private async postToolCall(
    params: {
      clientKinds?: DeviceClient[];
      deviceId?: string;
      operationId?: string;
      timeout?: number;
      userId: string;
      workspaceId?: string;
    },
    toolCall: {
      apiName: string;
      arguments: string;
      identifier: string;
      params?: GatewayMcpParams;
      type?: GatewayToolCallType;
    },
  ): Promise<DeviceToolCallResult> {
    const timeout =
      typeof params.timeout === 'number' && Number.isFinite(params.timeout)
        ? Math.max(Math.trunc(params.timeout), 0)
        : DEFAULT_GATEWAY_TOOL_CALL_TIMEOUT_MS;
    let res: Response;
    try {
      res = await this.post(
        '/api/device/tool-call',
        {
          clientKinds: params.clientKinds?.length
            ? params.clientKinds
            : this.clientKindsFor({
                identifier: toolCall.identifier,
                kind: 'tool',
                type: toolCall.type ?? 'tool',
              }),
          deviceId: params.deviceId,
          operationId: params.operationId,
          timeout: params.timeout,
          toolCall,
          userId: params.userId,
          workspaceId: params.workspaceId,
        },
        {
          timeout: Math.min(
            timeout + TOOL_CALL_HTTP_TIMEOUT_PADDING_MS,
            Math.max(timeout, TOOL_CALL_HTTP_DEADLINE_CAP_MS),
          ),
        },
      );
    } catch (error) {
      // A client-side deadline or an unreachable gateway host used to escape as
      // a raw `TimeoutError` / `fetch failed`, which reads to the model as if
      // the tool itself blew up. Describe the hop that actually failed instead.
      return toFailedToolCallResult(describeGatewayRequestFailure(error, 'tool call'));
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ...toFailedToolCallResult(
          describeGatewayResponseFailure(res.status, text, 'tool call', params),
        ),
        executionUnknown: true,
      };
    }

    const data = await res.json();

    // Device sends a typed envelope ({ content, state, success }). The legacy
    // fallback used to JSON.stringify `data.content ?? data` — when content was
    // missing it would stringify the *entire response body* including `success`
    // and any other top-level fields, which leaked the structured payload into
    // the LLM-facing content string. Only stringify the `content` field itself;
    // never fall back to the whole body.
    const deviceContent =
      typeof data.content === 'string'
        ? data.content
        : data.content === undefined || data.content === null
          ? ''
          : JSON.stringify(data.content);

    return {
      // A device that fails with nothing to say — an api it has no handler for,
      // a handler that threw before writing output — reported `content: ''`,
      // and `typeof '' === 'string'` short-circuited the error fallback below.
      // The failure then reached the model as an empty, successful-looking
      // result: observed live as a builder calling `screenshot` fifteen times
      // against a device with no browser handler and reading nothing back each
      // time. Every other failure path here puts the failure text in `content`.
      content: deviceContent || (typeof data.error === 'string' ? data.error : ''),
      error: data.error,
      ...(typeof data.executionUnknown === 'boolean' && {
        executionUnknown: data.executionUnknown,
      }),
      state: data.state,
      success: data.success ?? true,
    };
  }

  async executeMessageApi(
    params: { deviceId?: string; timeout?: number; userId: string; workspaceId?: string },
    api: { apiName: string; payload: Record<string, unknown>; platform: string },
  ): Promise<DeviceMessageApiResult> {
    const res = await this.post('/api/device/message-api', {
      api,
      clientKinds: this.clientKindsFor({ kind: 'messageApi', platform: api.platform }),
      deviceId: params.deviceId,
      timeout: params.timeout,
      userId: params.userId,
      workspaceId: params.workspaceId,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const failure = describeGatewayResponseFailure(res.status, text, 'message API call', params);
      return {
        content: failure.content,
        error: failure.error,
        ...(failure.data ? { errorData: failure.data } : {}),
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
    agentId?: string;
    agentType: string;
    assistantMessageId: string;
    /** Resolved `lh hetero exec` wrapper args. */
    args?: string[];
    /** Restricts the run to connections of these clients; omitted means any client. */
    clientKinds?: DeviceClient[];
    cwd?: string;
    deviceId?: string;
    /** Image attachments forwarded into the `agent_run_request` message. */
    imageList?: Array<{ id?: string; url: string }>;
    jwt: string;
    operationId: string;
    prompt: string;
    resumeFallbackSystemContext?: string;
    resumeSessionId?: string;
    systemContext?: string;
    timeout?: number;
    topicId: string;
    userId: string;
    workspaceId?: string;
    /**
     * Topic/run workspace for device-side ingest. Distinct from
     * {@link workspaceId}, which routes the request to a device pool. A
     * workspace topic dispatched to a personal device still needs this so
     * `lh hetero exec` can write back under the topic's scope.
     */
    ingestWorkspaceId?: string;
  }): Promise<{ success: boolean; error?: string; errorData?: DeviceUnavailableErrorData }> {
    const res = await this.post('/api/device/agent/run', params);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const failure = describeGatewayResponseFailure(res.status, text, 'agent run', params);
      return {
        error: failure.error,
        ...(failure.data ? { errorData: failure.data } : {}),
        success: false,
      };
    }
    const data = await res.json().catch(() => null);
    if (data && (data.success === false || data.status === 'rejected')) {
      return {
        error: data.error ?? data.reason ?? 'DEVICE_REJECTED',
        success: false,
      };
    }

    return { success: true };
  }

  /**
   * Invoke a named device-side method over the generic RPC relay. Server-only —
   * the gateway forwards `{ method, params }` opaquely to the device's RPC
   * dispatcher and correlates the response by `requestId`, so new methods need
   * no per-method gateway route. Distinct from {@link executeToolCall}, which is
   * the LLM-facing tool channel.
   *
   * `channel` names the connection to prefer when one device holds several
   * (e.g. `desktop` alongside `cli`). A gateway that predates the hint ignores
   * it and picks by its own channel priority, so callers must still handle an
   * answer from another channel.
   */
  async invokeRpc<T = unknown>(
    params: {
      channel?: string;
      deviceId?: string;
      timeout?: number;
      userId: string;
      workspaceId?: string;
    },
    rpc: { method: string; params?: unknown },
  ): Promise<DeviceRpcResult<T>> {
    const timeout =
      typeof params.timeout === 'number' && Number.isFinite(params.timeout)
        ? Math.max(Math.trunc(params.timeout), 0)
        : DEFAULT_GATEWAY_TOOL_CALL_TIMEOUT_MS;
    const res = await this.post(
      '/api/device/rpc',
      {
        channel: params.channel,
        clientKinds: this.clientKindsFor({ kind: 'rpc', method: rpc.method }),
        deviceId: params.deviceId,
        method: rpc.method,
        params: rpc.params,
        timeout: params.timeout,
        userId: params.userId,
        workspaceId: params.workspaceId,
      },
      { timeout: timeout + HTTP_CALL_TIMEOUT_PADDING_MS },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const failure = describeGatewayResponseFailure(res.status, text, 'RPC call', params);
      return {
        error: failure.error,
        ...(failure.data ? { errorData: failure.data } : {}),
        success: false,
      };
    }

    const data = await res.json();
    return { data: data.data, error: data.error, success: data.success ?? false };
  }

  /**
   * `options.clientKinds` selects the clients that can answer, such as the
   * desktop app when `lh connect` is also running.
   */
  async getDeviceSystemInfo(
    userId: string,
    deviceId: string,
    workspaceId?: string,
    options?: { clientKinds?: DeviceClient[] },
  ): Promise<{ error?: string; success: boolean; systemInfo?: DeviceSystemInfo }> {
    const res = await this.post(
      '/api/device/system-info',
      { clientKinds: options?.clientKinds, deviceId, userId, workspaceId },
      { timeout: DEVICE_QUERY_TIMEOUT_MS },
    );
    if (!res.ok) {
      // Keep the gateway's reason (`TIMEOUT`, `DEVICE_OFFLINE`, `DEVICE_NOT_FOUND`):
      // a device that did not answer is not a device that lacks a capability.
      const data = (await res.json().catch(() => undefined)) as { error?: string } | undefined;
      return { error: data?.error, success: false };
    }

    const data = await res.json();
    return {
      error: data.error,
      success: data.success ?? false,
      systemInfo: data.systemInfo,
    };
  }

  /**
   * Health samples the gateway holds for a device (it keeps two days), observed
   * at or after `since`. Served from gateway storage, so an offline device
   * still has its history.
   */
  async getDeviceMetrics(
    userId: string,
    deviceId: string,
    _options: { since?: number; workspaceId?: string } = {},
  ): Promise<DeviceMetricSample[]> {
    throw new Error('DEVICE_METRICS_UNSUPPORTED');
  }

  // ─── Tunnel registry (gateway admin API) ───
  //
  // These do NOT reach the device: they manage the slug → { device, port }
  // mapping that gives a tunnel its public hostname. Ownership is enforced
  // here, on the server — the gateway's admin API trusts the service token.

  /** Register a tunnel and return it with its public hostname. */
  async createTunnel(_params: {
    createdBy: string;
    deviceId: string;
    port: number;
    principal: string;
    ttlSeconds?: number;
  }): Promise<GatewayTunnelRegistration> {
    throw new Error('TUNNEL_UNSUPPORTED');
  }

  /** Every live tunnel owned by one principal. */
  async listTunnels(_principal: string): Promise<GatewayTunnelRegistration[]> {
    throw new Error('TUNNEL_UNSUPPORTED');
  }

  /** The registration behind a slug, or undefined when it is unknown or expired. */
  async resolveTunnel(_slug: string): Promise<GatewayTunnelRegistration | undefined> {
    throw new Error('TUNNEL_UNSUPPORTED');
  }

  /** Revoke a tunnel. Returns false when the slug was already gone. */
  async revokeTunnel(_slug: string): Promise<boolean> {
    throw new Error('TUNNEL_UNSUPPORTED');
  }

  private clientKindsFor(target: GatewayDispatchTarget): DeviceClient[] | undefined {
    const kinds = this.resolveClientKinds?.(target);
    return kinds && kinds.length > 0 ? kinds : undefined;
  }

  private async post(
    path: string,
    body: unknown,
    options?: { timeout?: number },
  ): Promise<Response> {
    const tenantId = this.options.tenantId;
    if (!tenantId || !TENANT_ID_PATTERN.test(tenantId)) throw new Error('TENANT_HEADER_INVALID');
    const data = body as Record<string, unknown>;
    const action = (
      {
        '/api/device/tool-call': 'device.tool-call',
        '/api/device/system-info': 'device.system-info',
        '/api/device/rpc': 'device.rpc',
        '/api/device/message-api': 'device.message-api',
        '/api/device/agent/run': 'device.agent/run',
      } as const
    )[path as '/api/device/rpc'];
    let envelope: GatewayDispatchEnvelope | undefined;
    if (action) {
      if (!this.options.execution || !this.options.prepareDispatch || !this.options.settleDispatch)
        throw new Error('TENANT_EXECUTION_VERSION_REQUIRED');
      envelope = await this.options.prepareDispatch({
        action,
        ...(typeof data.operationId === 'string' ? { operationId: data.operationId } : {}),
        resourceId: typeof data.deviceId === 'string' ? data.deviceId : '',
        targetPrincipal:
          typeof data.workspaceId === 'string'
            ? { kind: 'workspace', id: data.workspaceId }
            : { kind: 'user', id: String(data.userId ?? '') },
      });
      const intent = envelope.intent;
      if (
        envelope.tenantId !== tenantId ||
        intent.tenantId !== tenantId ||
        intent.sourceAcceptedVersion !== envelope.sourceAcceptedVersion ||
        intent.action !== action ||
        intent.attemptExpiresAt <= Date.now() ||
        !intent.attemptId ||
        !Number.isSafeInteger(envelope.sourceAcceptedVersion) ||
        envelope.sourceAcceptedVersion < 1 ||
        (data.operationId && intent.operationId !== data.operationId) ||
        intent.targetPrincipal.kind !== (data.workspaceId ? 'workspace' : 'user') ||
        intent.targetPrincipal.id !== (data.workspaceId ?? data.userId)
      )
        throw new Error('ATTEMPT_CONFLICT');
    }
    const response = await this.request(
      path,
      'POST',
      {
        ...data,
        ...(envelope
          ? {
              tenancyProtocol: 1,
              tenantId,
              sourceAcceptedVersion: envelope.sourceAcceptedVersion,
              intent: envelope.intent,
              deviceId: envelope.intent.resourceId,
            }
          : {}),
      },
      options?.timeout,
      envelope?.sourceAcceptedVersion,
    );
    if (!response.ok || !envelope) return response;
    const wire: unknown = await response.json();
    if (!isRecord(wire)) throw new Error('INVALID_GATEWAY_MESSAGE');
    const binding = wire.dispatchBinding;
    if (
      wire.tenantId !== tenantId ||
      wire.sourceAcceptedVersion !== envelope.sourceAcceptedVersion ||
      wire.attemptId !== envelope.intent.attemptId ||
      wire.operationId !== envelope.intent.operationId ||
      wire.toolCallId !== envelope.intent.toolCallId ||
      !isRecord(binding) ||
      typeof binding.connectionId !== 'string' ||
      !binding.connectionId ||
      typeof binding.authorizationId !== 'string' ||
      !binding.authorizationId ||
      typeof binding.connectionGeneration !== 'number' ||
      !Number.isSafeInteger(binding.connectionGeneration) ||
      binding.connectionGeneration < 1
    )
      throw new Error('ATTEMPT_CONFLICT');
    if (wire.outcome !== 'completed') throw new DeviceExecutionUnknownError(wire.outcome);
    if (!isRecord(wire.result)) throw new Error('INVALID_GATEWAY_MESSAGE');
    try {
      await this.options.settleDispatch!({
        envelope,
        reply: {
          ...wire,
          tenantId,
          sourceAcceptedVersion: envelope.sourceAcceptedVersion,
          attemptId: envelope.intent.attemptId,
          ...(envelope.intent.operationId ? { operationId: envelope.intent.operationId } : {}),
          ...(envelope.intent.toolCallId ? { toolCallId: envelope.intent.toolCallId } : {}),
          dispatchBinding: {
            ...binding,
            authorizationId: binding.authorizationId,
            connectionId: binding.connectionId,
            connectionGeneration: binding.connectionGeneration,
          },
          outcome: wire.outcome,
          result: wire.result,
        },
      });
    } catch (cause) {
      throw new DeviceDispatchSettlementError(cause);
    }
    return new Response(JSON.stringify(wire.result), {
      status: response.status,
      headers: response.headers,
    });
  }

  private async request(
    path: string,
    method: 'DELETE' | 'GET' | 'POST',
    data?: unknown,
    timeout = DEVICE_QUERY_TIMEOUT_MS,
    version?: number,
  ): Promise<Response> {
    const tenantId = this.options.tenantId;
    if (!tenantId || !TENANT_ID_PATTERN.test(tenantId)) throw new Error('TENANT_HEADER_INVALID');
    const url = strictGatewayUrl(this.gatewayUrl, path);
    // Frozen device reads use GET/query. Adding a query to `path` would encode it as pathname.
    if (method === 'GET') {
      for (const [key, value] of Object.entries((data ?? {}) as Record<string, string | undefined>))
        if (value !== undefined) url.searchParams.set(key, value);
    }
    const response = await fetch(url.toString(), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(timeout),
      headers: {
        'Authorization': `Bearer ${this.serviceToken}`,
        'Content-Type': 'application/json',
        'X-LobeHub-Gateway-Tenancy': '1',
        'X-LobeHub-Tenant-Id': tenantId,
        ...(version ? { 'X-LobeHub-Tenant-Version': String(version) } : {}),
      },
      ...(data === undefined || method === 'GET' ? {} : { body: JSON.stringify(data) }),
    });
    if (
      (response.status === 404 && response.headers.get('X-LobeHub-Gateway-Tenancy') !== '1') ||
      response.status === 426
    )
      throw new Error('GATEWAY_TENANCY_UNSUPPORTED');
    if (
      response.ok &&
      (response.headers.get('X-LobeHub-Gateway-Tenancy') !== '1' ||
        response.headers.get('X-LobeHub-Tenant-Id') !== tenantId)
    )
      throw new Error('TENANT_MISMATCH');
    return response;
  }
}
