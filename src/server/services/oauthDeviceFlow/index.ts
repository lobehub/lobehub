import { type OAuthDeviceFlowConfig } from '@/types/aiProvider';

export interface DeviceCodeResponse {
  deviceCode: string;
  expiresIn: number;
  interval: number;
  userCode: string;
  verificationUri: string;
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
}
