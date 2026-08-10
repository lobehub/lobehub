import { aicoEnv } from '@/envs/aico';

import {
  type CreateOpenRouterKeyResult,
  mapOpenRouterKeyInfo,
  type OpenRouterKeyInfo,
  parseCreateKeyResponse,
} from './createKeyResponse';

export type { CreateOpenRouterKeyResult, OpenRouterKeyInfo };
export { parseCreateKeyResponse };

const BASE_URL = 'https://openrouter.ai/api/v1/keys';

export type OpenRouterKeyLimitReset = 'daily' | 'weekly' | 'monthly' | null;

export interface OpenRouterManagementClient {
  createKey: (params: {
    limitUsd: number;
    limitReset?: OpenRouterKeyLimitReset;
    name: string;
  }) => Promise<CreateOpenRouterKeyResult>;
  deleteKey: (hash: string) => Promise<void>;
  getKey: (hash: string) => Promise<OpenRouterKeyInfo>;
  updateKey: (params: {
    disabled?: boolean;
    hash: string;
    limitUsd?: number;
    limitReset?: OpenRouterKeyLimitReset;
    name?: string;
  }) => Promise<OpenRouterKeyInfo>;
}

class HttpOpenRouterManagementClient implements OpenRouterManagementClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(path: string, init: RequestInit & { method: string }): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenRouter Management API ${res.status}: ${body || res.statusText}`);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  createKey: OpenRouterManagementClient['createKey'] = async (params) => {
    const json = await this.request<Record<string, unknown>>('', {
      body: JSON.stringify({
        limit: params.limitUsd,
        limit_reset: params.limitReset ?? null,
        name: params.name,
      }),
      method: 'POST',
    });
    return parseCreateKeyResponse(json);
  };

  getKey: OpenRouterManagementClient['getKey'] = async (hash) => {
    const json = await this.request<{ data: Record<string, unknown> }>(`/${hash}`, {
      method: 'GET',
    });
    return mapOpenRouterKeyInfo(json.data ?? (json as unknown as Record<string, unknown>));
  };

  updateKey: OpenRouterManagementClient['updateKey'] = async (params) => {
    const json = await this.request<{ data: Record<string, unknown> }>(`/${params.hash}`, {
      body: JSON.stringify({
        ...(params.disabled !== undefined ? { disabled: params.disabled } : {}),
        ...(params.limitUsd !== undefined ? { limit: params.limitUsd } : {}),
        ...(params.limitReset !== undefined ? { limit_reset: params.limitReset } : {}),
        ...(params.name !== undefined ? { name: params.name } : {}),
      }),
      method: 'PATCH',
    });
    return mapOpenRouterKeyInfo(json.data ?? (json as unknown as Record<string, unknown>));
  };

  deleteKey: OpenRouterManagementClient['deleteKey'] = async (hash) => {
    await this.request(`/${hash}`, { method: 'DELETE' });
  };
}

/**
 * Product-server client: proxies OpenRouter Management through the Aico control plane
 * so `OPENROUTER_MANAGEMENT_API_KEY` never lives on the customer app process.
 */
export class RemoteOpenRouterManagementClient implements OpenRouterManagementClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/internal/openrouter/v1/keys${path}`;
  }

  private async request<T>(path: string, init: RequestInit & { method: string }): Promise<T> {
    const res = await fetch(this.url(path), {
      ...init,
      headers: {
        'Authorization': `Bearer ${this.serviceToken}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Control plane OpenRouter proxy ${res.status}: ${body || res.statusText}`);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  createKey: OpenRouterManagementClient['createKey'] = async (params) => {
    const json = await this.request<Record<string, unknown>>('', {
      body: JSON.stringify({
        limit: params.limitUsd,
        limit_reset: params.limitReset ?? null,
        name: params.name,
      }),
      method: 'POST',
    });
    return parseCreateKeyResponse(json);
  };

  getKey: OpenRouterManagementClient['getKey'] = async (hash) => {
    const json = await this.request<{ data: Record<string, unknown> }>(
      `/${encodeURIComponent(hash)}`,
      { method: 'GET' },
    );
    return mapOpenRouterKeyInfo(json.data ?? (json as unknown as Record<string, unknown>));
  };

  updateKey: OpenRouterManagementClient['updateKey'] = async (params) => {
    const json = await this.request<{ data: Record<string, unknown> }>(
      `/${encodeURIComponent(params.hash)}`,
      {
        body: JSON.stringify({
          ...(params.disabled !== undefined ? { disabled: params.disabled } : {}),
          ...(params.limitUsd !== undefined ? { limit: params.limitUsd } : {}),
          ...(params.limitReset !== undefined ? { limit_reset: params.limitReset } : {}),
          ...(params.name !== undefined ? { name: params.name } : {}),
        }),
        method: 'PATCH',
      },
    );
    return mapOpenRouterKeyInfo(json.data ?? (json as unknown as Record<string, unknown>));
  };

  deleteKey: OpenRouterManagementClient['deleteKey'] = async (hash) => {
    await this.request(`/${encodeURIComponent(hash)}`, { method: 'DELETE' });
  };
}

/** Mock keys keep `limitReset` so period budgets can be asserted without OpenRouter. */
interface MockKeyRow extends CreateOpenRouterKeyResult {
  limitReset: OpenRouterKeyLimitReset;
}

/** In-memory mock for local QA without a real management key. */
class MockOpenRouterManagementClient implements OpenRouterManagementClient {
  private keys = new Map<string, MockKeyRow>();

  createKey: OpenRouterManagementClient['createKey'] = async (params) => {
    const hash = `mock_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
    const key = `sk-or-v1-mock-${hash}`;
    const row: MockKeyRow = {
      disabled: false,
      hash,
      key,
      limit: params.limitUsd,
      limitRemaining: params.limitUsd,
      limitReset: params.limitReset ?? null,
      name: params.name,
      usage: 0,
    };
    this.keys.set(hash, row);
    return { ...row };
  };

  getKey: OpenRouterManagementClient['getKey'] = async (hash) => {
    const row = this.keys.get(hash);
    if (!row) throw new Error(`OpenRouter mock key not found: ${hash}`);
    const { key: _k, ...info } = row;
    return info;
  };

  updateKey: OpenRouterManagementClient['updateKey'] = async (params) => {
    const row = this.keys.get(params.hash);
    if (!row) throw new Error(`OpenRouter mock key not found: ${params.hash}`);
    if (params.disabled !== undefined) row.disabled = params.disabled;
    if (params.limitUsd !== undefined) {
      row.limit = params.limitUsd;
      row.limitRemaining = Math.max(0, params.limitUsd - row.usage);
    }
    if (params.limitReset !== undefined) row.limitReset = params.limitReset;
    if (params.name !== undefined) row.name = params.name;
    const { key: _k, ...info } = row;
    return info;
  };

  deleteKey: OpenRouterManagementClient['deleteKey'] = async (hash) => {
    this.keys.delete(hash);
  };
}

const resolveControlPlaneRemote = (): RemoteOpenRouterManagementClient | null => {
  const url = aicoEnv.AICO_CONTROL_PLANE_URL;
  const token = aicoEnv.AICO_CONTROL_PLANE_SERVICE_TOKEN;
  if (!url || !token) return null;
  return new RemoteOpenRouterManagementClient(url, token);
};

let singleton: OpenRouterManagementClient | null = null;

export const createOpenRouterManagementClient = (
  options: { forceMock?: boolean; managementKey?: string } = {},
): OpenRouterManagementClient => {
  // `forceMock` is for tests only — callers must never set it from request-driven code.
  if (options.forceMock) {
    return new MockOpenRouterManagementClient();
  }
  if (options.managementKey) {
    return new HttpOpenRouterManagementClient(options.managementKey);
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const isControlPlane = aicoEnv.AICO_IS_CONTROL_PLANE;

  // Product servers must never hold the OpenRouter management key.
  if (!isControlPlane && aicoEnv.OPENROUTER_MANAGEMENT_API_KEY && isProduction) {
    throw new Error(
      'OPENROUTER_MANAGEMENT_API_KEY must not be set on the product server — configure AICO_CONTROL_PLANE_URL + AICO_CONTROL_PLANE_SERVICE_TOKEN instead.',
    );
  }

  // Prefer control-plane remote proxy whenever configured (product path).
  if (!isControlPlane) {
    const remote = resolveControlPlaneRemote();
    if (remote) return remote;
  }

  // Control plane (or explicit local key in non-prod) talks to OpenRouter directly.
  if (aicoEnv.OPENROUTER_MANAGEMENT_API_KEY) {
    return new HttpOpenRouterManagementClient(aicoEnv.OPENROUTER_MANAGEMENT_API_KEY);
  }

  // `AICO_OPENROUTER_MOCK` is a non-production QA convenience — ignored in
  // production except on the control plane when explicitly allowed for local moz
  // (no real management key yet).
  if (
    aicoEnv.AICO_OPENROUTER_MOCK &&
    (!isProduction || (isControlPlane && process.env.AICO_ALLOW_INSECURE_CONTROL_PLANE === '1'))
  ) {
    return new MockOpenRouterManagementClient();
  }

  if (isProduction) {
    if (isControlPlane) {
      throw new Error(
        'OPENROUTER_MANAGEMENT_API_KEY is required on the control plane in production — refusing to mock OpenRouter management calls.',
      );
    }
    throw new Error(
      'AICO_CONTROL_PLANE_URL and AICO_CONTROL_PLANE_SERVICE_TOKEN are required on the product server in production.',
    );
  }

  return new MockOpenRouterManagementClient();
};

export const getOpenRouterManagementClient = (): OpenRouterManagementClient => {
  singleton ??= createOpenRouterManagementClient();
  return singleton;
};

export const __resetOpenRouterManagementClientForTests = () => {
  singleton = null;
};
