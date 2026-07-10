import { type OAuthDeviceFlowConfig } from '@/types/aiProvider';

export interface DeviceCodeResponse {
  deviceCode: string;
  expiresIn: number;
  interval: number;
  userCode: string;
  verificationUri: string;
  /**
   * Optional verification URI with the user_code already embedded (RFC 8628
   * §3.3.1), so the user doesn't need to type the code manually.
   */
  verificationUriComplete?: string;
}

export interface TokenResponse {
  accessToken: string;
  expiresIn?: number;
  refreshToken?: string;
  scope?: string;
  tokenType: string;
}

export type PollStatus = 'pending' | 'success' | 'expired' | 'denied' | 'slow_down';

export interface PollResult {
  status: PollStatus;
  tokens?: TokenResponse;
}

/**
 * Thrown by `refreshAccessToken` when the authorization server rejects the
 * refresh_token as invalid/expired/already-consumed (`invalid_grant`).
 * Callers use this signal to re-read persisted credentials (another instance
 * may have rotated the token) before treating the grant as truly dead.
 */
export class OAuthInvalidGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthInvalidGrantError';
  }
}

/**
 * Parse the `exp` claim (ms timestamp) from a JWT access token WITHOUT
 * verifying the signature. Only used to decide when to proactively refresh —
 * never for trust decisions. Returns undefined for opaque / non-JWT tokens.
 */
export const parseJwtExpiry = (token: string | undefined): number | undefined => {
  if (!token) return undefined;

  const parts = token.split('.');
  if (parts.length < 2) return undefined;

  try {
    const payload = Buffer.from(parts[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64');
    const claims = JSON.parse(payload.toString('utf8'));

    if (typeof claims?.exp !== 'number') return undefined;

    return claims.exp * 1000;
  } catch {
    return undefined;
  }
};

export class OAuthDeviceFlowService {
  /**
   * Initiate OAuth Device Flow by requesting a device code
   */
  async initiateDeviceCode(config: OAuthDeviceFlowConfig): Promise<DeviceCodeResponse> {
    const response = await fetch(config.deviceCodeEndpoint, {
      body: new URLSearchParams({
        client_id: config.clientId,
        scope: config.scopes.join(' '),
      }).toString(),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to initiate device code: ${response.status} ${errorText}`);
    }

    const data = await response.json();

    return {
      deviceCode: data.device_code,
      expiresIn: data.expires_in,
      interval: data.interval ?? config.defaultPollingInterval ?? 5,
      userCode: data.user_code,
      verificationUri: data.verification_uri || data.verification_url,
      verificationUriComplete: data.verification_uri_complete,
    };
  }

  /**
   * Poll for authorization status
   */
  async pollForToken(config: OAuthDeviceFlowConfig, deviceCode: string): Promise<PollResult> {
    const response = await fetch(config.tokenEndpoint, {
      body: new URLSearchParams({
        client_id: config.clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).toString(),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    const data = await response.json();

    // Handle OAuth error responses
    if (data.error) {
      switch (data.error) {
        case 'authorization_pending': {
          return { status: 'pending' };
        }
        case 'slow_down': {
          return { status: 'slow_down' };
        }
        case 'expired_token': {
          return { status: 'expired' };
        }
        case 'access_denied': {
          return { status: 'denied' };
        }
        default: {
          throw new Error(`OAuth error: ${data.error} - ${data.error_description || ''}`);
        }
      }
    }

    // Success: access_token received
    if (data.access_token) {
      return {
        status: 'success',
        tokens: {
          accessToken: data.access_token,
          expiresIn: data.expires_in,
          refreshToken: data.refresh_token,
          scope: data.scope,
          tokenType: data.token_type || 'bearer',
        },
      };
    }

    throw new Error('Unexpected response from token endpoint');
  }

  /**
   * Exchange a refresh_token for a new access token (RFC 6749 §6).
   *
   * The provider may rotate the refresh_token: when the response carries a new
   * one the old one is invalidated server-side, so callers MUST persist
   * `refreshToken` from the returned tokens before relying on them.
   */
  async refreshAccessToken(
    config: OAuthDeviceFlowConfig,
    refreshToken: string,
  ): Promise<TokenResponse> {
    const response = await fetch(config.tokenEndpoint, {
      body: new URLSearchParams({
        client_id: config.clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.error) {
      // invalid_grant = refresh token expired / revoked / already consumed
      if (data.error === 'invalid_grant') {
        throw new OAuthInvalidGrantError(data.error_description || 'invalid_grant');
      }

      throw new Error(
        `Failed to refresh access token: ${response.status} ${data.error || ''} ${data.error_description || ''}`.trim(),
      );
    }

    if (!data.access_token) throw new Error('Unexpected response from token endpoint');

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
      // Rotation is optional per RFC 6749 — keep the old token when the
      // provider doesn't rotate.
      refreshToken: data.refresh_token || refreshToken,
      scope: data.scope,
      tokenType: data.token_type || 'bearer',
    };
  }
}
