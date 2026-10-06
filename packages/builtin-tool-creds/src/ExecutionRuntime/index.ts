import {
  getComposioAppByIdentifier,
  getLobehubSkillProviderById,
  OFFICIAL_URL,
} from '@lobechat/const';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { buildRequestCredsInputResult } from '../requestCredsInput';
import type {
  ConnectComposioServiceParams,
  InitiateOAuthConnectParams,
  InjectCredsToSandboxParams,
  RequestCredsInputParams,
} from '../types';
import { LOBEHUB_OAUTH_PROVIDER_LIST } from '../types';

/**
 * Service interface for Credentials operations
 * Abstracted to allow different implementations (e.g., MarketService-based)
 */
export interface ICredsService {
  /**
   * Get OAuth authorization URL
   */
  getOAuthAuthorizeUrl: (
    provider: string,
    redirectUri: string,
  ) => Promise<{
    authorizeUrl: string;
  }>;

  /**
   * Check if OAuth connection exists
   */
  getOAuthConnectionStatus: (provider: string) => Promise<{
    connected: boolean;
  }>;

  /**
   * Inject credentials into sandbox
   */
  injectCreds: (params: {
    keys: string[];
    sandbox?: boolean;
    topicId: string;
    userId: string;
  }) => Promise<{
    credentials?: {
      env?: Record<string, string>;
      files?: Array<{ filename: string; key: string; path: string }>;
    };
    notFound?: string[];
    success: boolean;
    unsupportedInSandbox?: string[];
  }>;

  /**
   * List all user credentials
   */
  listCreds: () => Promise<{
    data?: Array<{ id: number; key: string }>;
  }>;
}

/**
 * Creds Execution Runtime (Server-side)
 *
 * This runtime executes creds tools via the injected ICredsService.
 * The service handles context (userId, topicId) internally.
 *
 * Key differences from frontend executor:
 * - No browser APIs (window.open for OAuth)
 * - Direct service calls instead of tRPC client
 * - For OAuth: returns authorization URL instead of opening popup
 */
export class CredsExecutionRuntime {
  private credsService: ICredsService;
  private context: { topicId?: string; userId?: string };

  constructor(credsService: ICredsService, context: { topicId?: string; userId?: string } = {}) {
    this.credsService = credsService;
    this.context = context;
  }

  /**
   * Connect a Composio integration service
   * In server-side context, Composio OAuth requires browser interaction,
   * so we return a message guiding the user to connect via the UI.
   */
  async connectComposioService(
    args: ConnectComposioServiceParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    const { service } = args;

    const serverType = getComposioAppByIdentifier(service);
    if (!serverType) {
      return {
        content: `Unknown Composio service: "${service}". Check the available Composio services list in the credentials context.`,
        error: {
          message: `Unknown Composio service: ${service}`,
          type: 'UnknownService',
        },
        success: false,
      };
    }

    // Server-side cannot open OAuth popups or access browser stores.
    // Guide the user to connect via the frontend UI.
    return {
      content: `To connect ${serverType.label}, please use the LobeHub app UI to initiate the Composio OAuth flow. Server-side execution cannot open OAuth popups. Go to Settings or the onboarding page to connect ${serverType.label}.`,
      state: {
        connected: false,
        identifier: service,
        requiresUserAction: true,
        serviceName: serverType.label,
      },
      success: true,
    };
  }

  /**
   * Initiate OAuth connection flow
   * In server-side context, returns authorization URL for the user to click
   * (cannot open popup like frontend executor)
   */
  async initiateOAuthConnect(
    args: InitiateOAuthConnectParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { provider } = args;

      // Get provider config for display name
      const providerConfig = getLobehubSkillProviderById(provider);
      if (!providerConfig) {
        return {
          content: `Unknown OAuth provider: ${provider}. Available providers: ${LOBEHUB_OAUTH_PROVIDER_LIST}`,
          error: {
            message: `Unknown OAuth provider: ${provider}`,
            type: 'UnknownProvider',
          },
          success: false,
        };
      }

      // Check if already connected
      const statusResponse = await this.credsService.getOAuthConnectionStatus(provider);
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

      // Get the authorization URL
      // Note: In background execution, we cannot use window.location.origin
      // Normalize APP_URL by removing trailing slash to avoid double-slash in redirectUri
      const appUrl = (process.env.APP_URL || OFFICIAL_URL).replace(/\/+$/, '');
      const redirectUri = `${appUrl}/oauth/callback/success?provider=${provider}`;
      const response = await this.credsService.getOAuthAuthorizeUrl(provider, redirectUri);

      // In server-side context, return the URL for user to click
      // This is different from frontend which opens a popup
      return {
        content: `To connect to ${providerConfig.label}, please click the following authorization link:\n\n${response.authorizeUrl}\n\nAfter authorization, the credential will be automatically saved and available for use.`,
        state: {
          authorizeUrl: response.authorizeUrl,
          connected: false,
          providerName: providerConfig.label,
          requiresUserAction: true,
        },
        success: true,
      };
    } catch (error) {
      return {
        content: `Failed to initiate OAuth connection: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: {
          message: error instanceof Error ? error.message : 'Failed to initiate OAuth connection',
          type: 'InitiateOAuthFailed',
        },
        success: false,
      };
    }
  }

  /**
   * Inject credentials to sandbox environment
   */
  async injectCredsToSandbox(
    args: InjectCredsToSandboxParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    try {
      const topicId = this.context.topicId;
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

      const userId = this.context.userId;
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

      const result = await this.credsService.injectCreds({
        keys: args.keys,
        sandbox: true,
        topicId,
        userId,
      });

      const credentials = result.credentials || {};
      const notFound = result.notFound || [];
      const unsupportedInSandbox = result.unsupportedInSandbox || [];

      // Build response content
      const injectedKeys = args.keys.filter((k) => !notFound.includes(k));
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
      return {
        content: `Failed to inject credentials: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: {
          message: error instanceof Error ? error.message : 'Failed to inject credentials',
          type: 'InjectCredentialsFailed',
        },
        success: false,
      };
    }
  }

  /**
   * Runs after the user approves the secure form. The form already wrote the
   * values to the credential store, so this only confirms the key exists and
   * reports it — the values never pass through the agent run.
   */
  async requestCredsInput(args: RequestCredsInputParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const { data } = await this.credsService.listCreds();
      return buildRequestCredsInputResult(args, !!data?.some((cred) => cred.key === args.key));
    } catch (error) {
      return {
        content: `Failed to check credential "${args.key}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: {
          message: error instanceof Error ? error.message : 'Failed to check credential',
          type: 'CheckCredentialFailed',
        },
        success: false,
      };
    }
  }
}
