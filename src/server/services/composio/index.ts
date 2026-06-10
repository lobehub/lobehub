import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import type { LobeToolManifest } from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { PluginModel } from '@/database/models/plugin';
import { getComposioClient, isComposioClientAvailable } from '@/libs/composio';
import { type ToolExecutionResult } from '@/server/services/toolExecution/types';

const log = debug('lobe-server:composio-service');

const VALID_COMPOSIO_IDENTIFIERS = new Set(COMPOSIO_APP_TYPES.map((type) => type.identifier));

export interface ComposioToolExecuteParams {
  args: Record<string, any>;
  identifier: string;
  toolSlug: string;
}

export interface ComposioServiceOptions {
  db?: LobeChatDatabase;
  userId?: string;
}

export class ComposioService {
  private pluginModel?: PluginModel;
  private userId?: string;

  constructor(options: ComposioServiceOptions = {}) {
    const { db, userId } = options;
    this.userId = userId;

    if (db && userId) {
      this.pluginModel = new PluginModel(db, userId);
    }

    log(
      'ComposioService initialized: hasDB=%s, hasUserId=%s, isClientAvailable=%s',
      !!db,
      !!userId,
      isComposioClientAvailable(),
    );
  }

  async executeComposioTool(params: ComposioToolExecuteParams): Promise<ToolExecutionResult> {
    const { identifier, toolSlug, args } = params;

    log('executeComposioTool: %s/%s with args: %O', identifier, toolSlug, args);

    if (!isComposioClientAvailable()) {
      return {
        content: 'Composio service is not configured on server',
        error: { code: 'COMPOSIO_NOT_CONFIGURED', message: 'Composio API key not found' },
        success: false,
      };
    }

    if (!this.pluginModel || !this.userId) {
      return {
        content: 'Composio service is not properly initialized',
        error: {
          code: 'COMPOSIO_NOT_INITIALIZED',
          message: 'Database and userId are required for Composio tool execution',
        },
        success: false,
      };
    }

    try {
      const plugin = await this.pluginModel.findById(identifier);
      if (!plugin) {
        return {
          content: `Composio server "${identifier}" not found in database`,
          error: { code: 'COMPOSIO_SERVER_NOT_FOUND', message: `Server ${identifier} not found` },
          success: false,
        };
      }

      const composioParams = plugin.customParams?.composio;
      if (!composioParams?.connectedAccountId) {
        return {
          content: `Composio configuration not found for server "${identifier}"`,
          error: {
            code: 'COMPOSIO_CONFIG_NOT_FOUND',
            message: `Composio configuration missing for ${identifier}`,
          },
          success: false,
        };
      }

      const { connectedAccountId } = composioParams;

      log(
        'executeComposioTool: calling Composio API with connectedAccountId=%s',
        connectedAccountId,
      );

      const composioClient = getComposioClient();
      const result = await (composioClient.tools as any).execute(toolSlug, {
        arguments: args,
        connectedAccountId,
        // Toolkit version resolves to "latest"; allow manual execution without a
        // pinned version (Composio otherwise throws ComposioToolVersionRequiredError).
        dangerouslySkipVersionCheck: true,
        userId: this.userId,
      });

      log('executeComposioTool: response: %O', result);

      const data = result as any;
      const content = data?.data || data?.result || data;

      let resultContent = '';
      if (typeof content === 'string') {
        resultContent = content;
      } else if (Array.isArray(content)) {
        resultContent = content
          .map((item: any) => {
            if (typeof item === 'string') return item;
            if (item.type === 'text' && item.text) return item.text;
            return JSON.stringify(item);
          })
          .join('\n');
      } else {
        resultContent = JSON.stringify(content);
      }

      return { content: resultContent, success: true };
    } catch (error) {
      const err = error as Error;
      console.error(
        'ComposioService.executeComposioTool error %s/%s: %O',
        identifier,
        toolSlug,
        err,
      );

      return {
        content: err.message,
        error: { code: 'COMPOSIO_ERROR', message: err.message },
        success: false,
      };
    }
  }

  async getComposioManifests(): Promise<LobeToolManifest[]> {
    if (!this.pluginModel) {
      log('getComposioManifests: pluginModel not available, returning empty array');
      return [];
    }

    try {
      const allPlugins = await this.pluginModel.query();

      const composioPlugins = allPlugins.filter(
        (plugin) =>
          VALID_COMPOSIO_IDENTIFIERS.has(plugin.identifier) &&
          plugin.customParams?.composio?.status === 'ACTIVE',
      );

      log('getComposioManifests: found %d authenticated Composio plugins', composioPlugins.length);

      const manifests: LobeToolManifest[] = composioPlugins
        .map((plugin) => {
          if (!plugin.manifest) return null;

          const appType = COMPOSIO_APP_TYPES.find((t) => t.identifier === plugin.identifier);

          return {
            api: plugin.manifest.api || [],
            author: 'Composio',
            homepage: 'https://composio.dev',
            identifier: plugin.identifier,
            meta: plugin.manifest.meta || {
              avatar: '☁️',
              description: `Composio: ${appType?.label || plugin.identifier}`,
              tags: ['composio', 'mcp'],
              title: appType?.label || plugin.identifier,
            },
            type: 'builtin',
            version: '1.0.0',
          };
        })
        .filter(Boolean) as LobeToolManifest[];

      log('getComposioManifests: returning %d manifests', manifests.length);

      return manifests;
    } catch (error) {
      console.error('ComposioService.getComposioManifests error: %O', error);
      return [];
    }
  }
}
