import { aicoEnv } from '@/envs/aico';

const BASE_URL = 'https://openrouter.ai/api/v1/keys';

export type OpenRouterKeyLimitReset = 'daily' | 'weekly' | 'monthly' | null;

export interface OpenRouterKeyInfo {
  disabled: boolean;
  hash: string;
  limit: number | null;
  limitRemaining: number | null;
  name: string;
  usage: number;
}

export interface CreateOpenRouterKeyResult extends OpenRouterKeyInfo {
  /** Plaintext key — only available at creation time. Encrypt before persist. */
  key: string;
}

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
    name?: string;
  }) => Promise<OpenRouterKeyInfo>;
}

const mapKey = (data: Record<string, unknown>): OpenRouterKeyInfo => ({
  disabled: Boolean(data.disabled),
  hash: String(data.hash),
  limit: data.limit == null ? null : Number(data.limit),
  limitRemaining: data.limit_remaining == null ? null : Number(data.limit_remaining),
  name: String(data.name ?? ''),
  usage: Number(data.usage ?? 0),
});

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
    const data = (json.data as Record<string, unknown> | undefined) ?? json;
    const key = String(data.key ?? '');
    if (!key) throw new Error('OpenRouter createKey response missing key');
    return { ...mapKey(data), key };
  };

  getKey: OpenRouterManagementClient['getKey'] = async (hash) => {
    const json = await this.request<{ data: Record<string, unknown> }>(`/${hash}`, {
      method: 'GET',
    });
    return mapKey(json.data ?? (json as unknown as Record<string, unknown>));
  };

  updateKey: OpenRouterManagementClient['updateKey'] = async (params) => {
    const json = await this.request<{ data: Record<string, unknown> }>(`/${params.hash}`, {
      body: JSON.stringify({
        ...(params.disabled !== undefined ? { disabled: params.disabled } : {}),
        ...(params.limitUsd !== undefined ? { limit: params.limitUsd } : {}),
        ...(params.name !== undefined ? { name: params.name } : {}),
      }),
      method: 'PATCH',
    });
    return mapKey(json.data ?? (json as unknown as Record<string, unknown>));
  };

  deleteKey: OpenRouterManagementClient['deleteKey'] = async (hash) => {
    await this.request(`/${hash}`, { method: 'DELETE' });
  };
}

/** In-memory mock for local QA without a real management key. */
class MockOpenRouterManagementClient implements OpenRouterManagementClient {
  private keys = new Map<string, CreateOpenRouterKeyResult>();

  createKey: OpenRouterManagementClient['createKey'] = async (params) => {
    const hash = `mock_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
    const key = `sk-or-v1-mock-${hash}`;
    const row: CreateOpenRouterKeyResult = {
      disabled: false,
      hash,
      key,
      limit: params.limitUsd,
      limitRemaining: params.limitUsd,
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
    if (params.name !== undefined) row.name = params.name;
    const { key: _k, ...info } = row;
    return info;
  };

  deleteKey: OpenRouterManagementClient['deleteKey'] = async (hash) => {
    this.keys.delete(hash);
  };
}

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

  // `AICO_OPENROUTER_MOCK` is a non-production QA convenience only — ignored in production.
  if (!isProduction && aicoEnv.AICO_OPENROUTER_MOCK) {
    return new MockOpenRouterManagementClient();
  }

  if (aicoEnv.OPENROUTER_MANAGEMENT_API_KEY) {
    return new HttpOpenRouterManagementClient(aicoEnv.OPENROUTER_MANAGEMENT_API_KEY);
  }

  if (isProduction) {
    // Fail closed: never silently serve mock OpenRouter keys in production.
    throw new Error(
      'OPENROUTER_MANAGEMENT_API_KEY is required in production — refusing to mock OpenRouter management calls.',
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
