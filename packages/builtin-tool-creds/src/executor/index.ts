import { getLobehubSkillProviderById } from '@lobechat/const';
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import { lambdaClient, toolsClient } from '@/libs/trpc/client';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import { CredsIdentifier } from '../manifest';
import {
  CredsApiName,
  type GetPlaintextCredParams,
  type InitiateOAuthConnectParams,
  type InjectCredsToSandboxParams,
  type SaveCredsParams,
} from '../types';

const log = debug('lobe-creds:executor');

class CredsExecutor extends BaseExecutor<typeof CredsApiName> {
  readonly identifier = CredsIdentifier;
  protected readonly apiEnum = CredsApiName;

  /**
   * Initiate OAuth connection flow
   * Opens authorization popup and waits for user to complete authorization
   */
  initiateOAuthConnect = async (
    params: InitiateOAuthConnectParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      const { provider } = params;

      // Get provider config for display name
      const providerConfig = getLobehubSkillProviderById(provider);
      if (!providerConfig) {
        return {
          error: {
            message: `Unknown OAuth provider: ${provider}. Available providers: github, linear, microsoft, twitter`,
            type: 'UnknownProvider',
          },
          success: false,
        };
      }

      // Check if already connected
      const statusResponse = await toolsClient.market.connectGetStatus.query({ provider });
      if (statusResponse.connected) {
        return {
          content: `You are already connected to ${providerConfig.label}. The credential is available for use.`,
          state: {
            alreadyConnected: true,
            providerName: providerConfig.label,
          },
          success: true,
        };
      }

      // Get the authorization URL from the market API
      const redirectUri = `${typeof window !== 'undefined' ? window.location.origin : ''}/oauth/callback/success?provider=${provider}`;
      const response = await toolsClient.market.connectGetAuthorizeUrl.query({
        provider,
        redirectUri,
      });

      // Open OAuth popup and wait for result
      const result = await this.openOAuthPopupAndWait(response.authorizeUrl, provider);

      if (result.success) {
        return {
          content: `Successfully connected to ${providerConfig.label}! The credential is now available for use.`,
          state: {
            connected: true,
            providerName: providerConfig.label,
          },
          success: true,
        };
      } else {
        return {
          content: result.cancelled
            ? `Authorization was cancelled. You can try again when you're ready to connect to ${providerConfig.label}.`
            : `Failed to connect to ${providerConfig.label}. Please try again.`,
          state: {
            cancelled: result.cancelled,
            connected: false,
            providerName: providerConfig.label,
          },
          success: true,
        };
      }
    } catch (error) {
      return {
        error: {
          message: error instanceof Error ? error.message : 'Failed to initiate OAuth connection',
          type: 'InitiateOAuthFailed',
        },
        success: false,
      };
    }
  };

  /**
   * Open OAuth popup window and wait for authorization result
   */
  private openOAuthPopupAndWait = (
    authorizeUrl: string,
    provider: string,
  ): Promise<{ cancelled?: boolean; success: boolean }> => {
    return new Promise((resolve) => {
      // Open popup window
      const popup = window.open(authorizeUrl, '_blank', 'width=600,height=700');

      if (!popup) {
        // Popup blocked - fall back to checking status after a delay
        resolve({ cancelled: true, success: false });
        return;
      }

      let resolved = false;
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('message', handleMessage);
        if (windowCheckInterval) clearInterval(windowCheckInterval);
      };

      // Listen for postMessage from OAuth callback
      const handleMessage = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;

        if (
          event.data?.type === 'LOBEHUB_SKILL_AUTH_SUCCESS' &&
          event.data?.provider === provider
        ) {
          cleanup();
          resolve({ success: true });
        }
      };

      window.addEventListener('message', handleMessage);

      // Monitor popup window closure
      const windowCheckInterval = setInterval(async () => {
        if (popup.closed) {
          clearInterval(windowCheckInterval);

          if (resolved) return;

          // Check if authorization succeeded before window closed
          try {
            const status = await toolsClient.market.connectGetStatus.query({ provider });
            cleanup();
            resolve({ success: status.connected });
          } catch {
            cleanup();
            resolve({ cancelled: true, success: false });
          }
        }
      }, 500);

      // Timeout after 5 minutes
      setTimeout(
        () => {
          if (!resolved) {
            cleanup();
            if (!popup.closed) popup.close();
            resolve({ cancelled: true, success: false });
          }
        },
        5 * 60 * 1000,
      );
    });
  };

  /**
   * Get plaintext credential value by key
   */
  getPlaintextCred = async (
    params: GetPlaintextCredParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[CredsExecutor] getPlaintextCred - key:', params.key);

      // Get the decrypted credential directly by key
      const result = await lambdaClient.market.creds.getByKey.query({
        decrypt: true,
        key: params.key,
      });

      const credType = (result as any).type;
      const credName = (result as any).name || params.key;

      log('[CredsExecutor] getPlaintextCred - type:', credType);

      // Handle file type credentials
      if (credType === 'file') {
        const fileUrl = (result as any).fileUrl;
        const fileName = (result as any).fileName;

        log('[CredsExecutor] getPlaintextCred - fileUrl:', fileUrl ? 'present' : 'missing');

        if (!fileUrl) {
          return {
            content: `File credential "${credName}" (key: ${params.key}) found but file URL is not available.`,
            error: {
              message: 'File URL not available',
              type: 'FileUrlNotAvailable',
            },
            success: false,
          };
        }

        return {
          content: `Successfully retrieved file credential "${credName}" (key: ${params.key}). File: ${fileName || 'unknown'}. The file download URL is available in the state.`,
          state: {
            fileName,
            fileUrl,
            key: params.key,
            name: credName,
            type: 'file',
          },
          success: true,
        };
      }

      // Handle KV types (kv-env, kv-header, oauth)
      // Market API returns 'plaintext' field, SDK might transform to 'values'
      const values = (result as any).values || (result as any).plaintext || {};
      const valueKeys = Object.keys(values);

      log('[CredsExecutor] getPlaintextCred - result keys:', valueKeys);

      // Return content with masked values for security, but include actual values in state
      const maskedValues = valueKeys.map((k) => `${k}: ****`).join(', ');

      return {
        content: `Successfully retrieved credential "${credName}" (key: ${params.key}). Contains ${valueKeys.length} value(s): ${maskedValues}. The actual values are available in the state for use.`,
        state: {
          key: params.key,
          name: credName,
          type: credType,
          values,
        },
        success: true,
      };
    } catch (error) {
      log('[CredsExecutor] getPlaintextCred - error:', error);

      // Check if it's a NOT_FOUND error
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isNotFound = errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND');

      return {
        content: isNotFound
          ? `Credential not found: ${params.key}. Please check if the credential exists in Settings > Credentials.`
          : `Failed to get credential: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: isNotFound ? 'CredentialNotFound' : 'GetCredentialFailed',
        },
        success: false,
      };
    }
  };

  /**
   * Inject credentials to sandbox environment
   * Calls the SDK inject API to get decrypted credentials for sandbox injection.
   */
  injectCredsToSandbox = async (
    params: InjectCredsToSandboxParams,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      // Get topicId from context (like cloud-sandbox does)
      const topicId = ctx?.topicId;
      if (!topicId) {
        return {
          content: 'Cannot inject credentials: topicId is not available in the current context.',
          error: {
            message: 'topicId is required but not available',
            type: 'MissingTopicId',
          },
          success: false,
        };
      }

      // Get userId from user store (like cloud-sandbox does)
      const userId = userProfileSelectors.userId(useUserStore.getState());
      if (!userId) {
        return {
          content: 'Cannot inject credentials: user is not authenticated.',
          error: {
            message: 'userId is required but not available',
            type: 'MissingUserId',
          },
          success: false,
        };
      }

      log('[CredsExecutor] injectCredsToSandbox - keys:', params.keys, 'topicId:', topicId);

      // Call the inject API with keys, topicId and userId from context
      const result = await lambdaClient.market.creds.inject.mutate({
        keys: params.keys,
        sandbox: true,
        topicId,
        userId,
      });

      const credentials = (result as any).credentials || {};
      const notFound = (result as any).notFound || [];
      const unsupportedInSandbox = (result as any).unsupportedInSandbox || [];

      log('[CredsExecutor] injectCredsToSandbox - result:', {
        envKeys: Object.keys(credentials.env || {}),
        filesCount: credentials.files?.length || 0,
        notFound,
        unsupportedInSandbox,
      });

      // Build response content
      const injectedKeys = params.keys.filter((k) => !notFound.includes(k));
      let content = '';

      if (injectedKeys.length > 0) {
        content = `Credentials injected successfully: ${injectedKeys.join(', ')}.`;
      }

      if (notFound.length > 0) {
        content += ` Not found: ${notFound.join(', ')}. Please configure them in Settings > Credentials.`;
      }

      if (unsupportedInSandbox.length > 0) {
        content += ` Not supported in sandbox: ${unsupportedInSandbox.join(', ')}.`;
      }

      return {
        content: content.trim(),
        state: {
          credentials,
          injected: injectedKeys,
          notFound,
          success: notFound.length === 0,
          unsupportedInSandbox,
        },
        success: true,
      };
    } catch (error) {
      log('[CredsExecutor] injectCredsToSandbox - error:', error);
      return {
        content: `Failed to inject credentials: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: {
          message: error instanceof Error ? error.message : 'Failed to inject credentials',
          type: 'InjectCredentialsFailed',
        },
        success: false,
      };
    }
  };

  /**
   * Save new credentials
   */
  saveCreds = async (
    params: SaveCredsParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      log('[CredsExecutor] saveCreds - key:', params.key, 'name:', params.name);

      await lambdaClient.market.creds.createKV.mutate({
        description: params.description,
        key: params.key,
        name: params.name,
        type: params.type as 'kv-env' | 'kv-header',
        values: params.values,
      });

      return {
        content: `Credential "${params.name}" saved successfully with key "${params.key}"`,
        state: {
          key: params.key,
          message: `Credential "${params.name}" saved successfully`,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      log('[CredsExecutor] saveCreds - error:', error);
      return {
        content: `Failed to save credential: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: {
          message: error instanceof Error ? error.message : 'Failed to save credential',
          type: 'SaveCredentialFailed',
        },
        success: false,
      };
    }
  };
}

export const credsExecutor = new CredsExecutor();
