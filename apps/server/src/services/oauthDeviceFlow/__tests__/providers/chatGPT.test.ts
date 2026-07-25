// @vitest-environment node
import { CURRENT_VERSION } from '@lobechat/const';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatGPTOAuthService, extractChatGPTAccountId } from '../../providers/chatGPT';
import { getOAuthService } from '../../providers/githubCopilot';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const config = {
  clientId: 'codex-client',
  defaultPollingInterval: 8,
  deviceCodeEndpoint: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
  refreshTokenGrant: true,
  scopes: [],
  tokenEndpoint: 'https://auth.openai.com/oauth/token',
  tokenExchangeEndpoint: 'https://auth.openai.com/api/accounts/deviceauth/token',
};

const jsonResponse = (body: unknown, status = 200) => ({
  json: () => Promise.resolve(body),
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(JSON.stringify(body)),
});

const buildJwt = (claims: object) =>
  `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
    JSON.stringify(claims),
  ).toString('base64url')}.signature`;

describe('ChatGPTOAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is selected by the OAuth service factory', () => {
    expect(getOAuthService('chatgpt')).toBeInstanceOf(ChatGPTOAuthService);
  });

  it('initiates the Codex device flow and returns an opaque polling state', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        device_auth_id: 'device-auth-id',
        interval: '5',
        user_code: 'ABCD-EFGH',
      }),
    );

    const result = await new ChatGPTOAuthService().initiateDeviceCode(config);

    expect(result).toEqual({
      deviceCode: JSON.stringify({
        deviceAuthId: 'device-auth-id',
        userCode: 'ABCD-EFGH',
      }),
      expiresIn: 900,
      interval: 8,
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://auth.openai.com/codex/device',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      config.deviceCodeEndpoint,
      expect.objectContaining({
        body: JSON.stringify({ client_id: config.clientId }),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `LobeHub/${CURRENT_VERSION}`,
        },
        method: 'POST',
      }),
    );
  });

  it.each([403, 404])('treats HTTP %s from the polling endpoint as pending', async (status) => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, status));

    const result = await new ChatGPTOAuthService().pollForToken(
      config,
      JSON.stringify({ deviceAuthId: 'device-auth-id', userCode: 'ABCD-EFGH' }),
    );

    expect(result).toEqual({ status: 'pending' });
  });

  it('exchanges the authorized device code and extracts the ChatGPT account id', async () => {
    const idToken = buildJwt({
      'https://api.openai.com/auth': { chatgpt_account_id: 'account-id' },
    });
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          authorization_code: 'authorization-code',
          code_verifier: 'pkce-verifier',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'access-token',
          expires_in: 3600,
          id_token: idToken,
          refresh_token: 'refresh-token',
          token_type: 'bearer',
        }),
      );

    const result = await new ChatGPTOAuthService().pollForToken(
      config,
      JSON.stringify({ deviceAuthId: 'device-auth-id', userCode: 'ABCD-EFGH' }),
    );

    expect(result).toEqual({
      status: 'success',
      tokens: {
        accessToken: 'access-token',
        accountId: 'account-id',
        expiresIn: 3600,
        refreshToken: 'refresh-token',
        scope: undefined,
        tokenType: 'bearer',
      },
    });
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      config.tokenExchangeEndpoint,
      expect.objectContaining({
        body: JSON.stringify({
          device_auth_id: 'device-auth-id',
          user_code: 'ABCD-EFGH',
        }),
      }),
    );

    const tokenExchangeBody = mockFetch.mock.calls[1][1].body as string;
    expect(tokenExchangeBody).toContain('grant_type=authorization_code');
    expect(tokenExchangeBody).toContain('code=authorization-code');
    expect(tokenExchangeBody).toContain(
      'redirect_uri=https%3A%2F%2Fauth.openai.com%2Fdeviceauth%2Fcallback',
    );
    expect(tokenExchangeBody).toContain('code_verifier=pkce-verifier');
  });

  it('rejects tokens that do not contain a ChatGPT account id', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          authorization_code: 'authorization-code',
          code_verifier: 'pkce-verifier',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          token_type: 'bearer',
        }),
      );

    await expect(
      new ChatGPTOAuthService().pollForToken(
        config,
        JSON.stringify({ deviceAuthId: 'device-auth-id', userCode: 'ABCD-EFGH' }),
      ),
    ).rejects.toThrow('ChatGPT token response is missing an account id');
  });

  it('rejects malformed client-provided device state before making a request', async () => {
    await expect(new ChatGPTOAuthService().pollForToken(config, 'invalid')).rejects.toThrow(
      'Invalid ChatGPT device authorization state',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('extractChatGPTAccountId', () => {
  it('falls back to the access token and organization claim shapes', () => {
    const accessToken = buildJwt({ organizations: [{ id: 'organization-id' }] });

    expect(extractChatGPTAccountId(undefined, accessToken)).toBe('organization-id');
  });
});
