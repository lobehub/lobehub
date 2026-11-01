import superjson from 'superjson';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getProviderBindingRuntime } from './providerBindingPort';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getProviderBindingRuntime', () => {
  it('fetches only the selected provider under the current Desktop identity', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () =>
        ({
          result: {
            data: superjson.serialize({
              enabled: true,
              runtimeConfig: {
                config: {},
                keyVaults: { apiKey: 'secret' },
                settings: { sdkType: 'anthropic' },
              },
            }),
          },
        }) as any,
      ok: true,
      status: 200,
      statusText: 'OK',
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getProviderBindingRuntime(
      {
        getAccessToken: async () => 'token-1',
        getServerUrl: async () => 'https://app.example.com/',
      },
      {
        apiConfig: { model: 'claude-test', providerId: 'anthropic-custom' },
        kind: 'provider',
      },
    );

    expect(result.runtimeConfig?.keyVaults.apiKey).toBe('secret');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.example.com/trpc/lambda/aiProvider.getProviderBindingRuntime',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Oidc-Auth': 'token-1',
        }),
        method: 'POST',
      }),
    );
    const request = fetchMock.mock.calls[0][1];
    expect(request.headers).not.toHaveProperty('X-Workspace-Id');
    expect(superjson.deserialize(JSON.parse(request.body))).toEqual({ id: 'anthropic-custom' });
  });
});
