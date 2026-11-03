/**
 * ComfyUI Authentication Service
 *
 * Handles all authentication-related logic for ComfyUI connections
 * Supports 4 authentication modes: none, basic, bearer, custom
 */
import { type ComfyUIKeyVault } from '@lobechat/types';
import { createBasicAuthCredentials } from '@lobechat/utils';
import {
  type BasicCredentials,
  type BearerTokenCredentials,
  type CustomCredentials,
} from '@saintno/comfyui-sdk';
import debug from 'debug';

import { ServicesError } from '@/server/services/comfyui/errors';

const log = debug('lobe-image:comfyui:auth');

export class ComfyUIAuthService {
  private credentials: BasicCredentials | BearerTokenCredentials | CustomCredentials | undefined;
  private authHeaders: Record<string, string> | undefined;

  constructor(options: ComfyUIKeyVault) {
    log('🔐 Initializing authentication service');

    this.validateOptions(options);
    this.credentials = this.createCredentials(options);
    this.authHeaders = this.createAuthHeaders(options);

    log('✅ Authentication service initialized with type:', options.authType || 'none');
  }

  /**
   * Get credentials for ComfyUI SDK
   */
  getCredentials(): BasicCredentials | BearerTokenCredentials | CustomCredentials | undefined {
    return this.credentials;
  }

  /**
   * Get authentication headers for HTTP requests
   */
  getAuthHeaders(): Record<string, string> | undefined {
    return this.authHeaders;
  }

  /**
   * Validate authentication options
   */
  private validateOptions(options: ComfyUIKeyVault): void {
    const { authType = 'none', apiKey, username, password, customHeaders } = options;

    if (authType === 'basic' && (!username || !password)) {
      throw new ServicesError(
        'Basic authentication requires username and password',
        ServicesError.Reasons.INVALID_ARGS,
        { authType },
      );
    }

    if (authType === 'bearer' && !apiKey) {
      throw new ServicesError(
        'Bearer token authentication requires API key',
        ServicesError.Reasons.INVALID_AUTH,
        { authType },
      );
    }

    if (authType === 'custom' && (!customHeaders || Object.keys(customHeaders).length === 0)) {
      throw new ServicesError(
        'Custom authentication requires custom headers',
        ServicesError.Reasons.INVALID_ARGS,
        { authType },
      );
    }
  }

  /**
   * Create credentials object for ComfyUI SDK
   */
  private createCredentials(
    options: ComfyUIKeyVault,
  ): BasicCredentials | BearerTokenCredentials | CustomCredentials | undefined {
    const { authType = 'none', apiKey, username, password, customHeaders } = options;

    switch (authType) {
      case 'basic': {
        return {
          password: password!,
          type: 'basic',
          username: username!,
        } as BasicCredentials;
      }

      case 'bearer': {
        return {
          token: apiKey!,
          type: 'bearer_token',
        } as BearerTokenCredentials;
      }

      case 'custom': {
        return {
          headers: customHeaders!,
          type: 'custom',
        } as CustomCredentials;
      }

      default: {
        return undefined;
      }
    }
  }

  /**
   * Create authentication headers for direct HTTP requests
   */
  private createAuthHeaders(options: ComfyUIKeyVault): Record<string, string> | undefined {
    const { authType = 'none', apiKey, username, password, customHeaders } = options;

    switch (authType) {
      case 'basic': {
        if (username && password) {
          const basicAuth = createBasicAuthCredentials(username, password);
          return { Authorization: `Basic ${basicAuth}` };
        }
        break;
      }

      case 'bearer': {
        if (apiKey) {
          return { Authorization: `Bearer ${apiKey}` };
        }
        break;
      }

      case 'custom': {
        return customHeaders;
      }
    }

    return undefined;
  }
}
