import { type LobeToolManifest } from '@lobechat/context-engine';
import { type LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { PluginModel } from '@/database/models/plugin';
import { getKlavisClient, isKlavisClientAvailable } from '@/libs/klavis';
import { type ToolExecutionResult } from '@/server/services/toolExecution/types';

const log = debug('lobe-server:klavis-service');

export interface KlavisToolExecuteParams {
  args: Record<string, any>;
  /** Tool identifier (same as Klavis server identifier, e.g., 'google-calendar') */
  identifier: string;
  toolName: string;
}

export interface KlavisServiceOptions {
  db?: LobeChatDatabase;
  userId?: string;
}

/**
 * Klavis Service
 *
 * Provides a unified interface to Klavis Client with business logic encapsulation.
 * This service wraps Klavis Client methods to execute tools and fetch manifests.
 *
 * Usage:
 * ```typescript
 * // With database and userId (for manifest fetching)
 * const service = new KlavisService({ db, userId });
 * await service.executeKlavisTool({ identifier, toolName, args });
 *
 * // Without database (for tool execution only if you have serverUrl)
 * const service = new KlavisService();
 * ```
 */
export class KlavisService {
  private db?: LobeChatDatabase;
  private userId?: string;
  private pluginModel?: PluginModel;

  constructor(options: KlavisServiceOptions = {}) {
    const { db, userId } = options;

    this.db = db;
    this.userId = userId;

    if (db && userId) {
      this.pluginModel = new PluginModel(db, userId);
    }

    log(
      'KlavisService initialized: hasDB=%s, hasUserId=%s, isClientAvailable=%s',
      !!db,
      !!userId,
      isKlavisClientAvailable(),
    );
  }

  /**
   * Execute a Klavis tool
   * @param params - Tool execution parameters
   * @returns Tool execution result
   */
  async executeKlavisTool(params: KlavisToolExecuteParams): Promise<ToolExecutionResult> {
    const { identifier, toolName, args } = params;

    log('executeKlavisTool: %s/%s with args: %O', identifier, toolName, args);

    // Check if Klavis client is available
    if (!isKlavisClientAvailable()) {
      return {
        content: 'Klavis service is not configured on server',
        error: { code: 'KLAVIS_NOT_CONFIGURED', message: 'Klavis API key not found' },
        success: false,
      };
    }

    // Get serverUrl from plugin database
    if (!this.pluginModel) {
      return {
        content: 'Klavis service is not properly initialized',
        error: {
          code: 'KLAVIS_NOT_INITIALIZED',
          message: 'Database and userId are required for Klavis tool execution',
        },
        success: false,
      };
    }

    try {
      // Get plugin from database to retrieve serverUrl
      const plugin = await this.pluginModel.findById(identifier);
      if (!plugin) {
        return {
          content: `Klavis server "${identifier}" not found in database`,
          error: { code: 'KLAVIS_SERVER_NOT_FOUND', message: `Server ${identifier} not found` },
          success: false,
        };
      }

      const klavisParams = plugin.customParams?.klavis;
      if (!klavisParams || !klavisParams.serverUrl) {
        return {
          content: `Klavis configuration not found for server "${identifier}"`,
          error: {
            code: 'KLAVIS_CONFIG_NOT_FOUND',
            message: `Klavis configuration missing for ${identifier}`,
          },
          success: false,
        };
      }

      const { serverUrl } = klavisParams;

      log('executeKlavisTool: calling Klavis API with serverUrl=%s', serverUrl);

      // Call Klavis client
      const klavisClient = getKlavisClient();
      const response = await klavisClient.mcpServer.callTools({
        serverUrl,
        toolArgs: args,
        toolName,
      });

      log('executeKlavisTool: response: %O', response);

      // Handle error case
      if (!response.success || !response.result) {
        return {
          content: response.error || 'Unknown error',
          error: { code: 'KLAVIS_EXECUTION_ERROR', message: response.error || 'Unknown error' },
          success: false,
        };
      }

      // Process the response
      const content = response.result.content || [];
      const isError = response.result.isError || false;

      // Convert content array to string
      let resultContent = '';
      if (Array.isArray(content)) {
        resultContent = content
          .map((item: any) => {
            if (typeof item === 'string') return item;
            if (item.type === 'text' && item.text) return item.text;
            return JSON.stringify(item);
          })
          .join('\n');
      } else if (typeof content === 'string') {
        resultContent = content;
      } else {
        resultContent = JSON.stringify(content);
      }

      return {
        content: resultContent,
        success: !isError,
      };
    } catch (error) {
      const err = error as Error;
      console.error('KlavisService.executeKlavisTool error %s/%s: %O', identifier, toolName, err);

      return {
        content: err.message,
        error: { code: 'KLAVIS_ERROR', message: err.message },
        success: false,
      };
    }
  }

  /**
   * Fetch Klavis tool manifests from database
   * Gets user's connected Klavis servers and builds tool manifests for agent execution
   *
   * @returns Array of tool manifests for connected Klavis servers
   */
  async getKlavisManifests(): Promise<LobeToolManifest[]> {
    if (!this.pluginModel) {
      log('getKlavisManifests: pluginModel not available, returning empty array');
      return [];
    }

    try {
      // Get all plugins from database
      const allPlugins = await this.pluginModel.query();

      // Filter plugins that have klavis customParams and are authenticated
      const klavisPlugins = allPlugins.filter(
        (plugin) => plugin.customParams?.klavis?.isAuthenticated === true,
      );

      log('getKlavisManifests: found %d authenticated Klavis plugins', klavisPlugins.length);

      // Convert to LobeToolManifest format
      const manifests: LobeToolManifest[] = klavisPlugins
        .map((plugin) => {
          if (!plugin.manifest) return null;

          return {
            api: plugin.manifest.api || [],
            author: 'Klavis',
            homepage: 'https://klavis.ai',
            identifier: plugin.identifier,
            meta: plugin.manifest.meta || {
              avatar: '☁️',
              description: `Klavis MCP Server: ${plugin.customParams?.klavis?.serverName}`,
              tags: ['klavis', 'mcp'],
              title: plugin.customParams?.klavis?.serverName || plugin.identifier,
            },
            type: 'builtin',
            version: '1.0.0',
          };
        })
        .filter(Boolean) as LobeToolManifest[];

      log('getKlavisManifests: returning %d manifests', manifests.length);

      return manifests;
    } catch (error) {
      console.error('KlavisService.getKlavisManifests error: %O', error);
      return [];
    }
  }
}
