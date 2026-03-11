import type { ComfyUIKeyVault } from '@lobechat/types';
import { createBasicAuthCredentials } from '@lobechat/utils';
import debug from 'debug';

import type { LobeRuntimeAI } from '../../core/BaseAI';
import type {
  AuthenticatedImageRuntime,
  CreateImagePayload,
  CreateImageResponse,
} from '../../types';
import { parseComfyUIErrorMessage } from '../../utils/comfyuiErrorParser';
import { AgentRuntimeError } from '../../utils/createError';

const log = debug('lobe-image:comfyui');

/**
 * ComfyUI Runtime implementation
 * Supports text-to-image and image editing
 */
export class LobeComfyUI implements LobeRuntimeAI, AuthenticatedImageRuntime {
  private options: ComfyUIKeyVault;
  baseURL: string;

  constructor(options: ComfyUIKeyVault = {}) {
    log('🏗️ ComfyUI Runtime initialized');

    this.options = options;
    this.baseURL = options.baseURL || process.env.COMFYUI_DEFAULT_URL || 'http://localhost:8188';

    log('✅ ComfyUI Runtime ready - baseURL: %s', this.baseURL);
  }

  /**
   * Get authentication headers for image download
   * Used by framework for authenticated image downloads
   */
  getAuthHeaders(): Record<string, string> | undefined {
    log('🔐 Providing auth headers for image download');

    const { authType = 'none', apiKey, username, password, customHeaders } = this.options;

    switch (authType) {
      case 'basic': {
        if (username && password) {
          return { Authorization: `Basic ${createBasicAuthCredentials(username, password)}` };
        }
        return undefined;
      }

      case 'bearer': {
        if (apiKey) {
          return { Authorization: `Bearer ${apiKey}` };
        }
        return undefined;
      }

      case 'custom': {
        return customHeaders || undefined;
      }

      case 'none': {
        return undefined;
      }
    }
  }

  /**
   * Create image using internal API endpoint
   * Always uses full URL for consistency across environments
   */
  async createImage(payload: CreateImagePayload): Promise<CreateImageResponse> {
    log('🎨 Creating image with model: %s', payload.model);

    try {
      // Determine app URL with Vercel support
      const isInVercel = process.env.VERCEL === '1';
      const vercelUrl = `https://${process.env.VERCEL_URL}`;
      const appUrl =
        process.env.APP_URL ||
        (isInVercel ? vercelUrl : `http://localhost:${process.env.PORT || 3010}`);

      // Build headers with authentication
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
      };

      // In development mode, use debug header to bypass auth
      if (process.env.NODE_ENV === 'development') {
        headers['lobe-auth-dev-backend-api'] = '1';
      }

      // If KEY_VAULTS_SECRET is available (server-side), use it for internal service auth
      // But only if it's actually set (not empty string)
      const keyVaultSecret = process.env.KEY_VAULTS_SECRET;
      if (keyVaultSecret && keyVaultSecret.trim() !== '') {
        headers['Authorization'] = `Bearer ${keyVaultSecret}`;
      }

      const response = await fetch(`${appUrl}/webapi/create-image/comfyui`, {
        body: JSON.stringify({
          model: payload.model,
          options: this.options,
          params: payload.params,
        }),
        headers,
        method: 'POST',
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: any;

        try {
          errorData = JSON.parse(errorText);
        } catch {
          // If not JSON, use the text as error message
          errorData = { message: errorText, status: response.status };
        }

        // Check if it's already an AgentRuntimeError from WebAPI
        if (
          errorData &&
          typeof errorData === 'object' &&
          'errorType' in errorData &&
          'error' in errorData &&
          'provider' in errorData
        ) {
          // Already a properly formatted AgentRuntimeError from WebAPI
          // Reconstruct the error using the framework's method to ensure proper type
          throw AgentRuntimeError.createImage({
            error: errorData.error,
            errorType: errorData.errorType,
            provider: errorData.provider,
          });
        }

        // Otherwise parse and create new error
        const { error: parsedError, errorType } = parseComfyUIErrorMessage(errorData);

        throw AgentRuntimeError.createImage({
          error: parsedError,
          errorType,
          provider: 'comfyui',
        });
      }

      const result = await response.json();
      log('✅ ComfyUI image created successfully');
      return result;
    } catch (error) {
      log('❌ ComfyUI createImage error: %O', error);

      // If it looks like an AgentRuntimeError object structure (already processed), reconstruct it
      if (
        error &&
        typeof error === 'object' &&
        'errorType' in error &&
        'error' in error &&
        'provider' in error
      ) {
        throw AgentRuntimeError.createImage({
          error: (error as any).error,
          errorType: (error as any).errorType,
          provider: (error as any).provider,
        });
      }

      // Otherwise parse and format the error
      const { error: parsedError, errorType } = parseComfyUIErrorMessage(error);

      throw AgentRuntimeError.createImage({
        error: parsedError,
        errorType,
        provider: 'comfyui',
      });
    }
  }
}
