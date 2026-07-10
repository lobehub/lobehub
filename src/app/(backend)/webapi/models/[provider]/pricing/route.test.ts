// @vitest-environment node
import { ChatErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@/auth';
import { AiProviderModel } from '@/database/models/aiProvider';

import { GET } from './route';

vi.mock('@/app/(backend)/middleware/auth/utils', () => ({
  checkAuthMethod: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('@/database/models/aiProvider', () => {
  const mockGetAiProviderById = vi.fn();
  return {
    AiProviderModel: vi.fn().mockImplementation(() => ({
      getAiProviderById: mockGetAiProviderById,
    })),
  };
});

vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    getUserKeyVaults: vi.fn(),
  },
}));

const mockSsrfSafeFetch = vi.fn();
vi.mock('@lobechat/ssrf-safe-fetch', () => ({
  ssrfSafeFetch: (...args: any[]) => mockSsrfSafeFetch(...args),
}));

let request: Request;

beforeEach(() => {
  request = new Request(new URL('https://test.com'), {
    method: 'GET',
  });

  // Default: valid session
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {} as any,
    user: { id: 'test-user-id' } as any,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /webapi/models/[provider]/pricing', () => {
  it('should return ContentNotFound if provider config is missing', async () => {
    const mockParams = Promise.resolve({ provider: 'newapi' });
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue(undefined);

    const response = await GET(request, { params: mockParams });
    const responseBody = await response.json();

    expect(response.status).toBe(404);
    expect(responseBody.errorType).toBe(ChatErrorType.ContentNotFound);
  });

  it('should return BadRequest if baseURL is missing', async () => {
    const mockParams = Promise.resolve({ provider: 'newapi' });
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue({
      keyVaults: {
        apiKey: 'test-key',
      },
    } as any);

    const response = await GET(request, { params: mockParams });
    const responseBody = await response.json();

    expect(response.status).toBe(400);
    expect(responseBody.errorType).toBe(ChatErrorType.BadRequest);
  });

  it('should fetch pricing successfully', async () => {
    const mockParams = Promise.resolve({ provider: 'newapi' });
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue({
      keyVaults: {
        apiKey: 'test-key',
        baseURL: 'https://newapi.test.com/v1',
      },
    } as any);

    mockSsrfSafeFetch.mockResolvedValue({
      json: async () => ({ success: true, data: [{ model_name: 'test' }] }),
      ok: true,
    });

    const response = await GET(request, { params: mockParams });
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody).toEqual({ success: true, data: [{ model_name: 'test' }] });
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      'https://newapi.test.com/api/pricing',
      expect.any(Object),
    );
  });

  it('should fetch pricing from the requested custom provider config', async () => {
    const mockParams = Promise.resolve({ provider: 'custom-router' });
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue({
      keyVaults: {
        apiKey: 'custom-key',
        baseURL: 'https://custom-newapi.test.com/v1',
      },
    } as any);

    mockSsrfSafeFetch.mockResolvedValue({
      json: async () => ({ success: true, data: [{ model_name: 'custom-model' }] }),
      ok: true,
    });

    const response = await GET(request, { params: mockParams });
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody).toEqual({ success: true, data: [{ model_name: 'custom-model' }] });
    expect(mockModelInstance.getAiProviderById).toHaveBeenCalledWith(
      'custom-router',
      expect.any(Function),
    );
    expect(mockSsrfSafeFetch).toHaveBeenCalledWith(
      'https://custom-newapi.test.com/api/pricing',
      expect.any(Object),
    );
  });

  it('should fallback to fetch without auth if fetch with auth fails', async () => {
    const mockParams = Promise.resolve({ provider: 'newapi' });
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue({
      keyVaults: {
        apiKey: 'test-key',
        baseURL: 'https://newapi.test.com/v1',
      },
    } as any);

    mockSsrfSafeFetch.mockRejectedValueOnce(new Error('Auth fetch failed')).mockResolvedValueOnce({
      json: async () => ({ success: true, data: [{ model_name: 'test' }] }),
      ok: true,
    });

    const response = await GET(request, { params: mockParams });
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody).toEqual({ success: true, data: [{ model_name: 'test' }] });
    expect(mockSsrfSafeFetch).toHaveBeenCalledTimes(2);
  });

  it('should return BadGateway if external api call fails', async () => {
    const mockParams = Promise.resolve({ provider: 'newapi' });
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue({
      keyVaults: {
        apiKey: 'test-key',
        baseURL: 'https://newapi.test.com/v1',
      },
    } as any);

    mockSsrfSafeFetch.mockResolvedValue({
      ok: false,
      statusText: 'Bad Gateway',
    });

    const response = await GET(request, { params: mockParams });
    const responseBody = await response.json();

    expect(response.status).toBe(502);
    expect(responseBody.errorType).toBe(ChatErrorType.BadGateway);
  });

  it('should return InternalServerError if SSRF protection blocks the request', async () => {
    const mockParams = Promise.resolve({ provider: 'newapi' });
    const mockModelInstance = new AiProviderModel({} as any, 'test-user-id');
    vi.mocked(mockModelInstance.getAiProviderById).mockResolvedValue({
      keyVaults: {
        apiKey: 'test-key',
        baseURL: 'http://192.168.1.1/v1',
      },
    } as any);

    mockSsrfSafeFetch.mockRejectedValue(
      new Error(
        'SSRF blocked: http://192.168.1.1 is not allowed. See: https://lobehub.com/docs/self-hosting/environment-variables/basic#ssrf-allow-private-ip-address',
      ),
    );

    const response = await GET(request, { params: mockParams });
    const responseBody = await response.json();

    expect(response.status).toBe(500);
    expect(responseBody.errorType).toBe(ChatErrorType.InternalServerError);
  });
});
