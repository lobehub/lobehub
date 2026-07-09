import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import type { LobeToolManifest } from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { ConnectorModel } from '@/database/models/connector';
import { ConnectorToolModel } from '@/database/models/connectorTool';
import { PluginModel } from '@/database/models/plugin';
import type { UserConnectorToolItem } from '@/database/schemas';
import { getComposioClient, isComposioClientAvailable } from '@/libs/composio';
import { type ToolExecutionResult } from '@/server/services/toolExecution/types';

const log = debug('lobe-server:composio-service');

const VALID_COMPOSIO_IDENTIFIERS = new Set(COMPOSIO_APP_TYPES.map((type) => type.identifier));

export interface ComposioToolExecuteParams {
  /**
   * Agent scope: prefer the agent-owned connector row (`agent_id = agentId`)
   * for this identifier, so a service-account agent runs off its own Composio
   * account instead of the caller's (Agent > Workspace/Personal).
   */
  agentId?: string;
  args: Record<string, any>;
  identifier: string;
  toolSlug: string;
}

export interface ComposioServiceOptions {
  db?: LobeChatDatabase;
  userId?: string;
  /**
   * Workspace scope. When set, connector/plugin rows resolve within the team
   * workspace instead of the caller's personal scope (fixes workspace-installed
   * Composio connectors being invisible at runtime — LOBE-10891).
   */
  workspaceId?: string;
}

/**
 * Server-side Composio runtime.
 *
 * Source of truth is `user_connectors` (+ `user_connector_tools`): a Composio
 * connection lives on a connector row whose `metadata.composio` carries the
 * runtime config (`connectedAccountId`). The legacy `user_installed_plugins`
 * projection is still read as a **fallback** for connections created before the
 * dual-write landed, so no data migration is required.
 */
export class ComposioService {
  private pluginModel?: PluginModel;
  private connectorModel?: ConnectorModel;
  private connectorToolModel?: ConnectorToolModel;
  private userId?: string;

  constructor(options: ComposioServiceOptions = {}) {
    const { db, userId, workspaceId } = options;
    this.userId = userId;

    if (db && userId) {
      // Scope to the caller's workspace (personal when undefined). Agent-scoped
      // resolution is a per-call refinement on top of this, applied via the
      // connector model's resolve* methods.
      this.pluginModel = new PluginModel(db, userId, workspaceId);
      this.connectorModel = new ConnectorModel(db, userId, workspaceId);
      this.connectorToolModel = new ConnectorToolModel(db, userId, workspaceId);
    }

    log(
      'ComposioService initialized: hasDB=%s, hasUserId=%s, hasWorkspace=%s, isClientAvailable=%s',
      !!db,
      !!userId,
      !!workspaceId,
      isComposioClientAvailable(),
    );
  }

  async executeComposioTool(params: ComposioToolExecuteParams): Promise<ToolExecutionResult> {
    const { identifier, toolSlug, args, agentId } = params;

    log('executeComposioTool: %s/%s with args: %O', identifier, toolSlug, args);

    if (!isComposioClientAvailable()) {
      return {
        content: 'Composio service is not configured on server',
        error: { code: 'COMPOSIO_NOT_CONFIGURED', message: 'Composio API key not found' },
        success: false,
      };
    }

    if (!this.userId || (!this.connectorModel && !this.pluginModel)) {
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
      const connectedAccountId = await this.resolveConnectedAccountId(identifier, agentId);
      if (!connectedAccountId) {
        return {
          content: `Composio configuration not found for server "${identifier}"`,
          error: {
            code: 'COMPOSIO_CONFIG_NOT_FOUND',
            message: `Composio configuration missing for ${identifier}`,
          },
          success: false,
        };
      }

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

  /**
   * Resolve the Composio `connectedAccountId` for an identifier.
   * Connector metadata first (new path), preferring the agent-owned row when an
   * `agentId` is given (Agent > Workspace/Personal); plugin customParams as
   * fallback (old connections without a connector projection).
   */
  private async resolveConnectedAccountId(
    identifier: string,
    agentId?: string,
  ): Promise<string | undefined> {
    if (this.connectorModel) {
      const [connector] = await this.connectorModel.resolveByIdentifiers([identifier], agentId);
      const fromConnector = connector?.metadata?.composio?.connectedAccountId;
      if (fromConnector) return fromConnector;
    }

    if (this.pluginModel) {
      const plugin = await this.pluginModel.findById(identifier);
      return plugin?.customParams?.composio?.connectedAccountId;
    }

    return undefined;
  }

  async getComposioManifests(agentId?: string): Promise<LobeToolManifest[]> {
    const manifests: LobeToolManifest[] = [];
    const coveredIdentifiers = new Set<string>();

    // 1. Connector-based (new path): rows whose metadata.composio marks them as
    //    Composio connectors and are ACTIVE. Tool defs come from
    //    user_connector_tools (all of them, so disabled tools stay visible for
    //    downstream permission patching). Resolved agent-aware: an agent-owned
    //    Composio connector shadows the base one for the same identifier.
    if (this.connectorModel && this.connectorToolModel) {
      try {
        const connectors = await this.connectorModel.resolveAll(agentId);
        const composioConnectors = connectors.filter(
          (c) => c.isEnabled && c.metadata?.composio?.status === 'ACTIVE',
        );

        if (composioConnectors.length > 0) {
          const tools = await this.connectorToolModel.queryAllByConnectorIds(
            composioConnectors.map((c) => c.id),
          );
          const toolsByConnector = new Map<string, UserConnectorToolItem[]>();
          for (const tool of tools) {
            const list = toolsByConnector.get(tool.userConnectorId) ?? [];
            list.push(tool);
            toolsByConnector.set(tool.userConnectorId, list);
          }

          for (const connector of composioConnectors) {
            const connectorTools = toolsByConnector.get(connector.id) ?? [];
            if (connectorTools.length === 0) continue;

            const appType = COMPOSIO_APP_TYPES.find((t) => t.identifier === connector.identifier);
            const label = connector.name || appType?.label || connector.identifier;

            manifests.push({
              api: connectorTools.map((t) => ({
                description: t.description ?? '',
                name: t.toolName,
                parameters: (t.inputSchema ?? { properties: {}, type: 'object' }) as Record<
                  string,
                  unknown
                >,
              })),
              author: 'Composio',
              homepage: 'https://composio.dev',
              identifier: connector.identifier,
              meta: {
                avatar: connector.metadata?.avatar || '☁️',
                description: `Composio: ${label}`,
                tags: ['composio', 'mcp'],
                title: label,
              },
              type: 'builtin',
              version: '1.0.0',
            } as LobeToolManifest);
            coveredIdentifiers.add(connector.identifier);
          }
        }
      } catch (error) {
        console.error('ComposioService.getComposioManifests (connector) error: %O', error);
      }
    }

    // 2. Plugin-based fallback (old path): only for identifiers not already
    //    covered by a connector projection. Preserves manifests for connections
    //    created before dual-write, so no migration is needed.
    if (this.pluginModel) {
      try {
        const allPlugins = await this.pluginModel.query();
        const composioPlugins = allPlugins.filter(
          (plugin) =>
            VALID_COMPOSIO_IDENTIFIERS.has(plugin.identifier) &&
            plugin.customParams?.composio?.status === 'ACTIVE' &&
            !coveredIdentifiers.has(plugin.identifier),
        );

        for (const plugin of composioPlugins) {
          if (!plugin.manifest) continue;
          const appType = COMPOSIO_APP_TYPES.find((t) => t.identifier === plugin.identifier);

          manifests.push({
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
          } as LobeToolManifest);
        }
      } catch (error) {
        console.error('ComposioService.getComposioManifests (plugin) error: %O', error);
      }
    }

    log('getComposioManifests: returning %d manifests', manifests.length);

    return manifests;
  }
}
