import { CURRENT_VERSION } from '@lobechat/const';

import type { OAuthDeviceFlowConfig } from '@/types/aiProvider';

import { type DeviceCodeResponse, OAuthDeviceFlowService, type PollResult } from '../index';

const DEVICE_CODE_TTL_SECONDS = 15 * 60;
const POLLING_SAFETY_MARGIN_SECONDS = 3;
const USER_AGENT = `LobeHub/${CURRENT_VERSION}`;

interface ChatGPTDeviceState {
  deviceAuthId: string;
  userCode: string;
}

interface ChatGPTTokenClaims {
  'chatgpt_account_id'?: string;
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string;
  };
  'organizations'?: { id?: string }[];
}

const parseTokenClaims = (token?: string): ChatGPTTokenClaims | undefined => {
  if (!token) return undefined;

  const parts = token.split('.');
  if (parts.length !== 3) return undefined;

  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
};

export const extractChatGPTAccountId = (
  idToken?: string,
  accessToken?: string,
): string | undefined => {
  for (const token of [idToken, accessToken]) {
    const claims = parseTokenClaims(token);
    const accountId =
      claims?.chatgpt_account_id ||
      claims?.['https://api.openai.com/auth']?.chatgpt_account_id ||
      claims?.organizations?.[0]?.id;

    if (accountId) return accountId;
  }

  return undefined;
};

const parseDeviceState = (deviceCode: string): ChatGPTDeviceState => {
  try {
    const state = JSON.parse(deviceCode);
    if (typeof state?.deviceAuthId === 'string' && typeof state?.userCode === 'string') {
      return state;
    }
  } catch {
    // Fall through to the stable user-facing error below.
  }

  throw new Error('Invalid ChatGPT device authorization state');
};

/**
 * OpenAI's Codex device login is a two-stage flow:
 * 1. poll the device endpoint for an authorization code + PKCE verifier
 * 2. exchange that code at the standard OAuth token endpoint
 */
export class ChatGPTOAuthService extends OAuthDeviceFlowService {
  override async initiateDeviceCode(config: OAuthDeviceFlowConfig): Promise<DeviceCodeResponse> {
    const response = await fetch(config.deviceCodeEndpoint, {
      body: JSON.stringify({ client_id: config.clientId }),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      method: 'POST',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to initiate device code: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    if (!data?.device_auth_id || !data?.user_code) {
      throw new Error('Invalid ChatGPT device code response');
    }

    const issuer = new URL(config.tokenEndpoint).origin;
    const providerInterval = Number.parseInt(data.interval, 10);
    const interval = Number.isFinite(providerInterval)
      ? Math.max(providerInterval, 1) + POLLING_SAFETY_MARGIN_SECONDS
      : config.defaultPollingInterval || 8;

    return {
      deviceCode: JSON.stringify({
        deviceAuthId: data.device_auth_id,
        userCode: data.user_code,
      } satisfies ChatGPTDeviceState),
      expiresIn: DEVICE_CODE_TTL_SECONDS,
      interval,
      userCode: data.user_code,
      verificationUri: `${issuer}/codex/device`,
    };
  }

  override async pollForToken(
    config: OAuthDeviceFlowConfig,
    deviceCode: string,
  ): Promise<PollResult> {
    if (!config.tokenExchangeEndpoint) {
      throw new Error('ChatGPT device token endpoint is not configured');
    }

    const state = parseDeviceState(deviceCode);
    const pollResponse = await fetch(config.tokenExchangeEndpoint, {
      body: JSON.stringify({
        device_auth_id: state.deviceAuthId,
        user_code: state.userCode,
      }),
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      method: 'POST',
    });

    if (pollResponse.status === 403 || pollResponse.status === 404) {
      return { status: 'pending' };
    }

    if (!pollResponse.ok) {
      const errorText = await pollResponse.text();
      throw new Error(`Failed to poll device authorization: ${pollResponse.status} ${errorText}`);
    }

    const authorization = await pollResponse.json();
    if (!authorization?.authorization_code || !authorization?.code_verifier) {
      throw new Error('Invalid ChatGPT device authorization response');
    }

    const issuer = new URL(config.tokenEndpoint).origin;
    const tokenResponse = await fetch(config.tokenEndpoint, {
      body: new URLSearchParams({
        client_id: config.clientId,
        code: authorization.authorization_code,
        code_verifier: authorization.code_verifier,
        grant_type: 'authorization_code',
        redirect_uri: `${issuer}/deviceauth/callback`,
      }).toString(),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    const tokens = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokens.access_token) {
      throw new Error(
        `Failed to exchange ChatGPT authorization code: ${tokenResponse.status} ${tokens.error || ''} ${tokens.error_description || ''}`.trim(),
      );
    }

    const accountId = extractChatGPTAccountId(tokens.id_token, tokens.access_token);
    if (!accountId) {
      throw new Error('ChatGPT token response is missing an account id');
    }

    return {
      status: 'success',
      tokens: {
        accessToken: tokens.access_token,
        accountId,
        expiresIn: tokens.expires_in,
        refreshToken: tokens.refresh_token,
        scope: tokens.scope,
        tokenType: tokens.token_type || 'bearer',
      },
    };
  }
}
