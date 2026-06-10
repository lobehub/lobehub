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

let request: Request;
const mockFetch = vi.fn();

beforeEach(() => {
  request = new Request(new URL('https://test.com'), {
    method: 'GET',
  });

  // Default: valid session
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: {} as any,
    user: { id: 'test-user-id' } as any,
  });

  global.fetch = mockFetch;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /webapi/models/[provider]/pricing', () => {
  it('should return BadRequest if provider is not newapi', async () => {
    const mockParams = Promise.resolve({ provider: 'openai' });
    const response = await GET(request, { params: mockParams });
    const responseBody = await response.json();

    expect(response.status).toBe(400);
    expect(responseBody.errorType).toBe(ChatErrorType.BadRequest);
  });

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

    mockFetch.mockResolvedValue({
      json: async () => ({ success: true, data: [{ model_name: 'test' }] }),
      ok: true,
    });

    const response = await GET(request, { params: mockParams });
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody).toEqual({ success: true, data: [{ model_name: 'test' }] });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://newapi.test.com/api/pricing',
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

    mockFetch.mockRejectedValueOnce(new Error('Auth fetch failed')).mockResolvedValueOnce({
      json: async () => ({ success: true, data: [{ model_name: 'test' }] }),
      ok: true,
    });

    const response = await GET(request, { params: mockParams });
    const responseBody = await response.json();

    expect(response.status).toBe(200);
    expect(responseBody).toEqual({ success: true, data: [{ model_name: 'test' }] });
    expect(mockFetch).toHaveBeenCalledTimes(2);
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

    mockFetch.mockResolvedValue({
      ok: false,
      statusText: 'Bad Gateway',
    });

    const response = await GET(request, { params: mockParams });
    const responseBody = await response.json();

    expect(response.status).toBe(502);
    expect(responseBody.errorType).toBe(ChatErrorType.BadGateway);
  });
});
