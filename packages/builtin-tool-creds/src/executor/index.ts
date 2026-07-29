import { getComposioAppByIdentifier, getLobehubSkillProviderById } from '@lobechat/const';
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';
import debug from 'debug';

import { lambdaClient, toolsClient } from '@/libs/trpc/client';
import { getToolStoreState, useToolStore } from '@/store/tool';
import { composioStoreSelectors } from '@/store/tool/selectors';
import { ComposioServerStatus } from '@/store/tool/slices/composioStore/types';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';

import { CredsIdentifier } from '../manifest';
import type {
  ConnectComposioServiceParams,
  InitiateOAuthConnectParams,
  InjectCredsToSandboxParams,
  SaveCredsParams,
} from '../types';
import { CredsApiName, LOBEHUB_OAUTH_PROVIDER_LIST } from '../types';

const log = debug('lobe-creds:executor');

class CredsExecutor extends BaseExecutor<typeof CredsApiName> {
  readonly identifier = CredsIdentifier;
  protected readonly apiEnum = CredsApiName;

  /**
   * Connect a Composio integration service via OAuth
   * Creates a Composio connection and initiates the OAuth flow
   */
  connectComposioService = async (
    params: ConnectComposioServiceParams,
    _ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      const { service } = params;

      // Validate service identifier
      const appType = getComposioAppByIdentifier(service);
      if (!appType) {
        return {
          error: {
            message: `Unknown Composio service: "${service}". Check the available Composio services list in the credentials context.`,
            type: 'UnknownService',
          },
          success: false,
        };
      }

      // Check if already connected via store
      const toolState = getToolStoreState();
      const existingServer = composioStoreSelectors.getServerByIdentifier(service)(toolState);
      if (existingServer?.status === ComposioServerStatus.ACTIVE) {
        return {
          content: `Already connected to ${appType.label}. You can use ${appType.label} tools directly.`,
          state: {
            connected: true,
            identifier: service,
            serviceName: appType.label,
          },
          success: true,
        };
      }

      log('[CredsExecutor] connectComposioService - creating connection for:', service);

      // Create Composio connection (authConfigId managed server-side)
      const server = await useToolStore.getState().createComposioConnection({
        appSlug: appType.appSlug,
        identifier: appType.identifier,
        label: appType.label,
      });

      if (!server) {
        return {
          error: {
            message: `Failed to create Composio connection for ${appType.label}`,
            type: 'CreateServerFailed',
          },
          success: false,
        };
      }

      // If already active (no OAuth needed)
      if (server.status === ComposioServerStatus.ACTIVE) {
        return {
          content: `Successfully connected to ${appType.label}! You can now use ${appType.label} tools.`,
          state: {
            connected: true,
            identifier: service,
            serviceName: appType.label,
          },
          success: true,
        };
      }

      // OAuth needed — return the authorization link for the user to open.
      // This tool runs from the agent's response, which carries no user gesture,
      // so the browser would block any popup we tried to open ourselves. Handing
      // back the link lets the user click it (a real gesture) to authorize; the
      // connection moves to ACTIVE once they finish.
      if (server.redirectUrl) {
        return {
          content: `To connect ${appType.label}, ask the user to open this authorization link and complete the sign-in:\n\n${server.redirectUrl}\n\nOnce they have authorized, ${appType.label} tools will be ready to use.`,
          state: {
            connected: false,
            identifier: service,
            redirectUrl: server.redirectUrl,
            serviceName: appType.label,
          },
          success: true,
        };
      }

      return {
        error: {
          message: 'Unexpected server state: no redirectUrl and not active',
          type: 'UnexpectedState',
        },
        success: false,
      };
    } catch (error) {
      log('[CredsExecutor] connectComposioService - error:', error);
      return {
        error: {
          message: error instanceof Error ? error.message : 'Failed to connect Composio service',
          type: 'ConnectComposioFailed',
        },
        success: false,
      };
    }
  };

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
            message: `Unknown OAuth provider: ${provider}. Available providers: ${LOBEHUB_OAUTH_PROVIDER_LIST}`,
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
      // Skip redirectUri on desktop (app:// protocol) since the system browser can't navigate to it
      const redirectUri =
        typeof window !== 'undefined' && window.location.protocol.startsWith('http')
          ? `${window.location.origin}/oauth/callback/success?provider=${provider}`
          : undefined;
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
      // Normalize params: AI may send `displayName` instead of `name`,
      // or `value` (env-style string) instead of `values` (Record)
      const raw = params as any;
      const name: string = params.name || raw.displayName || params.key;

      let values: Record<string, string> = params.values;
      if (!values && typeof raw.value === 'string') {
        values = {};
        for (const line of (raw.value as string).split('\n')) {
          const idx = line.indexOf('=');
          if (idx > 0) {
            values[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        }
      }

      if (!values || Object.keys(values).length === 0) {
        return {
          content:
            'Failed to save credential: values must be a non-empty object of key-value pairs (e.g., { "API_KEY": "sk-xxx" }).',
          error: {
            message: 'values is empty or missing. Provide key-value pairs, not a raw string.',
            type: 'InvalidParams',
          },
          success: false,
        };
      }

      log('[CredsExecutor] saveCreds - key:', params.key, 'name:', name);

      await lambdaClient.market.creds.createKV.mutate({
        description: params.description,
        key: params.key,
        name,
        type: params.type as 'kv-env' | 'kv-header',
        values,
      });

      return {
        content: `Credential "${name}" saved successfully with key "${params.key}"`,
        state: {
          key: params.key,
          message: `Credential "${name}" saved successfully`,
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
