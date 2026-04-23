import { getKlavisServerByServerIdentifier, getLobehubSkillProviderById } from '@lobechat/const';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  ConnectKlavisServiceParams,
  GetPlaintextCredParams,
  InitiateOAuthConnectParams,
  InjectCredsToSandboxParams,
  SaveCredsParams,
} from '../types';

/**
 * Service interface for Credentials operations
 * Abstracted to allow different implementations (e.g., MarketService-based)
 */
export interface ICredsService {
  /**
   * Get plaintext credential by key
   */
  getByKey: (
    key: string,
    options?: { decrypt?: boolean },
  ) => Promise<{
    fileName?: string;
    fileUrl?: string;
    name?: string;
    plaintext?: Record<string, string>;
    type: string;
    values?: Record<string, string>;
  }>;

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

  /**
   * Save KV credential
   */
  saveKVCred: (params: {
    description?: string;
    key: string;
    name: string;
    type: 'kv-env' | 'kv-header';
    values: Record<string, string>;
  }) => Promise<{ id: number }>;
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
   * Connect a Klavis integration service
   * In server-side context, Klavis OAuth requires browser interaction,
   * so we return a message guiding the user to connect via the UI.
   */
  async connectKlavisService(
    args: ConnectKlavisServiceParams,
  ): Promise<BuiltinServerRuntimeOutput> {
    const { service } = args;

    const serverType = getKlavisServerByServerIdentifier(service);
    if (!serverType) {
      return {
        content: `Unknown Klavis service: "${service}". Check the available Klavis services list in the credentials context.`,
        error: {
          message: `Unknown Klavis service: ${service}`,
          type: 'UnknownService',
        },
        success: false,
      };
    }

    // Server-side cannot open OAuth popups or access browser stores.
    // Guide the user to connect via the frontend UI.
    return {
      content: `To connect ${serverType.label}, please use the LobeHub app UI to initiate the Klavis OAuth flow. Server-side execution cannot open OAuth popups. Go to Settings or the onboarding page to connect ${serverType.label}.`,
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
          content: `Unknown OAuth provider: ${provider}. Available providers: github, linear, microsoft, twitter, vercel`,
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
      const appUrl = (process.env.APP_URL || 'https://app.lobehub.com').replace(/\/+$/, '');
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
   * Get plaintext credential value by key
   */
  async getPlaintextCred(args: GetPlaintextCredParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      const result = await this.credsService.getByKey(args.key, { decrypt: true });

      const credType = result.type;
      const credName = result.name || args.key;

      // Handle file type credentials
      if (credType === 'file') {
        const fileUrl = result.fileUrl;
        const fileName = result.fileName;

        if (!fileUrl) {
          return {
            content: `File credential "${credName}" (key: ${args.key}) found but file URL is not available.`,
            error: {
              message: 'File URL not available',
              type: 'FileUrlNotAvailable',
            },
            success: false,
          };
        }

        return {
          content: `Successfully retrieved file credential "${credName}" (key: ${args.key}). File: ${fileName || 'unknown'}. The file download URL is available in the state.`,
          state: {
            fileName,
            fileUrl,
            key: args.key,
            name: credName,
            type: 'file',
          },
          success: true,
        };
      }

      // Handle KV types (kv-env, kv-header, oauth)
      const values = result.values || result.plaintext || {};
      const valueKeys = Object.keys(values);

      // Return content with masked values for security, but include actual values in state
      const maskedValues = valueKeys.map((k) => `${k}: ****`).join(', ');

      return {
        content: `Successfully retrieved credential "${credName}" (key: ${args.key}). Contains ${valueKeys.length} value(s): ${maskedValues}. The actual values are available in the state for use.`,
        state: {
          key: args.key,
          name: credName,
          type: credType,
          values,
        },
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isNotFound = errorMessage.includes('not found') || errorMessage.includes('NOT_FOUND');

      return {
        content: isNotFound
          ? `Credential not found: ${args.key}. Please check if the credential exists in Settings > Credentials.`
          : `Failed to get credential: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: isNotFound ? 'CredentialNotFound' : 'GetCredentialFailed',
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
   * Save new credentials
   */
  async saveCreds(args: SaveCredsParams): Promise<BuiltinServerRuntimeOutput> {
    try {
      // Only support kv-env and kv-header types in server runtime
      // File upload requires frontend interaction
      if (args.type !== 'kv-env' && args.type !== 'kv-header') {
        return {
          content: `Credential type "${args.type}" is not supported in background execution. Only kv-env and kv-header types are supported.`,
          error: {
            message: `Unsupported credential type: ${args.type}`,
            type: 'UnsupportedCredentialType',
          },
          success: false,
        };
      }

      await this.credsService.saveKVCred({
        description: args.description,
        key: args.key,
        name: args.name,
        type: args.type,
        values: args.values,
      });

      return {
        content: `Credential "${args.name}" saved successfully with key "${args.key}"`,
        state: {
          key: args.key,
          message: `Credential "${args.name}" saved successfully`,
          success: true,
        },
        success: true,
      };
    } catch (error) {
      return {
        content: `Failed to save credential: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error: {
          message: error instanceof Error ? error.message : 'Failed to save credential',
          type: 'SaveCredentialFailed',
        },
        success: false,
      };
    }
  }
}
