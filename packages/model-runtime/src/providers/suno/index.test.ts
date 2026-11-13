import { AgentRuntimeErrorType } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ModelRuntime } from '../../core/ModelRuntime';
import { providerRuntimeMap } from '../../runtimeMap';
import {
  LobeSunoAI,
  normalizeSunoBaseURL,
  resolveSunoGatewayDialect,
  SUNO_DEFAULT_BASE_URL,
} from './index';

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
    ...init,
  });

describe('LobeSunoAI', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('is registered as the suno runtime', () => {
    expect(providerRuntimeMap.suno).toBe(LobeSunoAI);
  });

  it('requires an API key', () => {
    expect(() => new LobeSunoAI({ apiKey: '  ' })).toThrow(
      expect.objectContaining({ errorType: AgentRuntimeErrorType.InvalidProviderAPIKey }),
    );
  });

  describe('gateway selection', () => {
    it('defaults to kie.ai and tolerates a trailing /api/v1 or slash', () => {
      expect(normalizeSunoBaseURL()).toBe(SUNO_DEFAULT_BASE_URL);
      expect(normalizeSunoBaseURL('https://api.kie.ai/api/v1/')).toBe('https://api.kie.ai');
      expect(normalizeSunoBaseURL('https://gw.example.com///')).toBe('https://gw.example.com');
      expect(normalizeSunoBaseURL('   ')).toBe(SUNO_DEFAULT_BASE_URL);
      expect(new LobeSunoAI({ apiKey: 'k' }).dialect).toBe('kie');
    });

    it('uses the sunoapi.org dialect only for sunoapi.org hosts', () => {
      expect(resolveSunoGatewayDialect('https://api.sunoapi.org')).toBe('sunoapi');
      expect(resolveSunoGatewayDialect('https://sunoapi.org')).toBe('sunoapi');
      expect(resolveSunoGatewayDialect('https://notsunoapi.org')).toBe('kie');
      expect(resolveSunoGatewayDialect('http://localhost:3000')).toBe('kie');
      expect(resolveSunoGatewayDialect('not a url')).toBe('kie');
    });
  });

  describe('checkCredentials', () => {
    it('reads the kie.ai credit endpoint with a bearer key and returns the balance', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ code: 200, data: 100.5, msg: 'success' }));

      const result = await new LobeSunoAI({ apiKey: ' key-1 ' }).checkCredentials();

      expect(result).toEqual({ balance: 100.5 });
      expect(fetchMock).toHaveBeenCalledWith('https://api.kie.ai/api/v1/chat/credit', {
        headers: { 'Authorization': 'Bearer key-1', 'Content-Type': 'application/json' },
        method: 'GET',
        signal: expect.any(AbortSignal),
      });
    });

    it('reads the sunoapi.org credit endpoint for that gateway', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ code: 200, data: 42, msg: 'success' }));

      await new LobeSunoAI({
        apiKey: 'k',
        baseURL: 'https://api.sunoapi.org/api/v1',
      }).checkCredentials();

      expect(fetchMock.mock.calls[0][0]).toBe('https://api.sunoapi.org/api/v1/generate/credit');
    });

    it('maps the gateway 401 inside an HTTP 200 to InvalidProviderAPIKey with its message', async () => {
      // Real kie.ai / sunoapi.org response to a bad key
      fetchMock.mockResolvedValue(
        jsonResponse({
          code: 401,
          msg: 'Unauthorized – Authentication failed. Please check that your Authorization and Content-Type headers are correctly set.',
        }),
      );

      await expect(new LobeSunoAI({ apiKey: 'bad' }).checkCredentials()).rejects.toEqual({
        error: {
          code: 401,
          message:
            'Unauthorized – Authentication failed. Please check that your Authorization and Content-Type headers are correctly set.',
          provider: 'suno',
        },
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
      });
    });

    it('maps 402 to InsufficientQuota and other gateway codes to ProviderBizError', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ code: 402, msg: 'Insufficient credits' }));
      await expect(new LobeSunoAI({ apiKey: 'k' }).checkCredentials()).rejects.toMatchObject({
        errorType: AgentRuntimeErrorType.InsufficientQuota,
      });

      fetchMock.mockResolvedValueOnce(jsonResponse({ code: 455, msg: 'Under maintenance' }));
      await expect(new LobeSunoAI({ apiKey: 'k' }).checkCredentials()).rejects.toMatchObject({
        error: { code: 455, message: 'Under maintenance' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      });
    });

    it('falls back to the HTTP status when the body is not gateway JSON', async () => {
      fetchMock.mockResolvedValue(
        new Response('Forbidden', { status: 403, statusText: 'Forbidden' }),
      );

      await expect(new LobeSunoAI({ apiKey: 'k' }).checkCredentials()).rejects.toMatchObject({
        error: { code: 403, message: 'Forbidden' },
        errorType: AgentRuntimeErrorType.InvalidProviderAPIKey,
      });
    });

    it('does not pass a 200 response that is not a gateway reply', async () => {
      fetchMock.mockResolvedValue(
        new Response('<html>landing page</html>', { headers: { 'Content-Type': 'text/html' } }),
      );

      await expect(new LobeSunoAI({ apiKey: 'k' }).checkCredentials()).rejects.toMatchObject({
        error: { message: expect.stringContaining('did not answer like a Suno gateway') },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      });
    });

    it('reports an unreachable gateway as ProviderBizError', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      await expect(new LobeSunoAI({ apiKey: 'k' }).checkCredentials()).rejects.toMatchObject({
        error: { message: 'fetch failed', provider: 'suno' },
        errorType: AgentRuntimeErrorType.ProviderBizError,
      });
    });

    it('is reachable through ModelRuntime', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ code: 200, data: 7 }));

      const runtime = await ModelRuntime.initializeWithProvider('suno', { apiKey: 'k' });

      await expect(runtime.checkCredentials()).resolves.toEqual({ balance: 7 });
    });
  });
});

describe('ModelRuntime.checkCredentials', () => {
  it('returns undefined for a runtime without a credential check', async () => {
    const runtime = new ModelRuntime({} as any);
    await expect(runtime.checkCredentials()).resolves.toBeUndefined();
  });
});
