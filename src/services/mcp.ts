import { CURRENT_VERSION, isDesktop } from '@lobechat/const';
import {
  type ChatToolPayload,
  type CheckMcpInstallResult,
  type CustomPluginMetadata,
} from '@lobechat/types';
import { isLocalOrPrivateUrl, safeParseJSON } from '@lobechat/utils';
import { deserializeMcpIpcPayload, serializeMcpIpcPayload } from '@lobechat/utils/mcpIpcPayload';
import { toRecord } from '@lobechat/utils/object';
import { type PluginManifest } from '@lobehub/market-sdk';
import { type CallReportRequest } from '@lobehub/market-types';
import { type ReadResourceResult } from '@modelcontextprotocol/client';

import { type MCPToolCallResult } from '@/libs/mcp';
import { getMCPConnectionErrorType } from '@/libs/mcp/utils';
import { toolsClient } from '@/libs/trpc/client';
import { getServerConfigStoreState } from '@/store/serverConfig/store';
import { ensureElectronIpc } from '@/utils/electron/ipc';

import { discoverService } from './discover';

/**
 * Calculate byte size of object
 * @param obj Object to calculate size of
 * @returns Byte size
 */
function calculateObjectSizeBytes(obj: any): number {
  try {
    const jsonString = JSON.stringify(obj);
    return new TextEncoder().encode(jsonString).length;
  } catch (error) {
    console.warn('Failed to calculate object size:', error);
    return 0;
  }
}

/**
 * Build the MCP client params for an installed/custom plugin: its stored
 * connection plus the user's plugin settings as HTTP headers or stdio env.
 */
const buildPluginMcpParams = (
  plugin: { customParams?: { mcp?: any } | null; settings?: unknown },
  identifier: string,
) => {
  const connection = plugin.customParams?.mcp;
  const settingsEntries = plugin.settings
    ? Object.entries(plugin.settings as Record<string, any>).filter(
        ([, value]) => value !== undefined && value !== null,
      )
    : [];
  const pluginSettings =
    settingsEntries.length > 0
      ? settingsEntries.reduce<Record<string, unknown>>((acc, [key, value]) => {
          acc[key] = value;

          return acc;
        }, {})
      : undefined;

  const params = {
    ...connection,
    name: identifier,
  } as any;

  if (connection?.type === 'http') {
    params.headers = {
      ...connection.headers,
      ...pluginSettings,
    };
  }

  if (connection?.type === 'stdio') {
    params.env = {
      ...connection?.env,
      ...pluginSettings,
    };
  }

  return { params, pluginSettings };
};

class MCPService {
  async invokeMcpToolCall(
    payload: ChatToolPayload,
    {
      agentId,
      localHttpOverIpc,
      signal,
      topicId,
    }: {
      /** Resolve connectors the way this agent's conversation does (agent-owned first). */
      agentId?: string;
      /**
       * On desktop, run a localhost / LAN http plugin over IPC instead of the
       * server relay. Only an MCP App view's calls set it, as its HTML was read
       * the same way; conversation calls keep their existing route.
       */
      localHttpOverIpc?: boolean;
      signal?: AbortSignal;
      topicId?: string;
    },
  ) {
    await discoverService.safeInjectMPToken();

    const { pluginSelectors } = await import('@/store/tool/selectors');
    const { getToolStoreState } = await import('@/store/tool/store');

    const s = getToolStoreState();
    const { identifier, arguments: args, apiName } = payload;

    // Connector-first: HTTP connectors use their server-held credentials.
    // Standalone desktop stdio connectors use local IPC; configured device
    // gateways keep the existing server route.
    // Only connectors with a real MCP endpoint are routed here — Lobehub/Composio
    // skills synced into the connector store have no mcpServerUrl and keep their
    // original executor path.
    const { connectorSelectors } = await import('@/store/tool/slices/connector/selectors');
    const connector = connectorSelectors.connectorByIdentifierForAgent(identifier, agentId)(s);
    const installPlugin = pluginSelectors.getInstalledPluginById(identifier)(s);
    const customPlugin = pluginSelectors.getCustomPluginById(identifier)(s);

    const plugin = installPlugin || customPlugin;

    // An agent's own connectors may not be loaded on the client yet; with no
    // plugin to fall back to, let the server resolve the identifier for the agent.
    const isConnector = connector
      ? connector.isEnabled && (!!connector.mcpServerUrl || connector.mcpConnectionType === 'stdio')
      : !!agentId && !plugin;
    if (isConnector) {
      const { lambdaClient } = await import('@/libs/trpc/client');
      if (
        connector &&
        isDesktop &&
        connector.mcpConnectionType === 'stdio' &&
        getServerConfigStoreState()?.serverConfig.deviceGatewayConfigured === false
      ) {
        // Persisted connector projections omit env secrets and may be stale.
        // This protected read retains the connector's credential ownership gate.
        const detail = await lambdaClient.connector.getForEdit.query({ id: connector.id });
        if (!detail.isEnabled) throw new Error('Connector is disabled');
        const tool = detail.tools.find((item) => item.toolName === apiName);
        if (!tool || tool.permission === 'disabled') {
          throw new Error(`Tool '${apiName}' is unavailable or disabled for this connector`);
        }
        const config = detail.mcpStdioConfig;
        if (detail.mcpConnectionType !== 'stdio' || !config?.command) {
          throw new Error('Connector does not have a stdio command configured');
        }
        const result = await ensureElectronIpc().mcp.callTool(
          serializeMcpIpcPayload({
            args: safeParseJSON(args) ?? {},
            env: config.env,
            params: {
              args: config.args ?? [],
              command: config.command,
              name: detail.identifier,
              type: 'stdio',
            },
            toolName: apiName,
          }),
        );
        return deserializeMcpIpcPayload<MCPToolCallResult>(result);
      }
      try {
        return (await lambdaClient.connector.callTool.mutate(
          { agentId, args, identifier, toolName: apiName },
          { signal },
        )) as MCPToolCallResult;
      } catch (error) {
        const data = toRecord(toRecord(error)?.data)?.errorData;
        const type = getMCPConnectionErrorType({ data });
        if (!type) throw error;
        // Keep expected upstream connection errors visible in tool cards. An
        // unrelated connector or LobeHub authentication failure still throws.
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: message,
          error: { message, type },
          state: { content: [{ text: message, type: 'text' }], isError: true },
          success: false,
        } satisfies MCPToolCallResult;
      }
    }

    if (!plugin) return;

    const connection = plugin.customParams?.mcp;
    const { params, pluginSettings } = buildPluginMcpParams(plugin, identifier);

    const isStdio = plugin?.customParams?.mcp?.type === 'stdio';
    const isCloud = plugin?.customParams?.mcp?.type === 'cloud';
    // localhost / LAN endpoints are only reachable from this machine
    const isLocalHttp =
      !!localHttpOverIpc &&
      isDesktop &&
      plugin?.customParams?.mcp?.type === 'http' &&
      isLocalOrPrivateUrl(params.url);
    const isCustomPlugin = !!customPlugin;

    // Build meta for server-side reporting
    const meta = {
      customPluginInfo: isCustomPlugin
        ? {
            avatar: plugin.manifest?.meta.avatar,
            description: plugin.manifest?.meta.description,
            name: plugin.manifest?.meta.title,
          }
        : undefined,
      isCustomPlugin,
      sessionId: topicId,
      version: plugin.manifest?.version || 'unknown',
    };

    const data = {
      // For desktop IPC, always pass a record/object for tool "arguments"
      // (IPC layer serializes the whole payload into a JSON envelope).
      args: isDesktop && isStdio ? (safeParseJSON(args) ?? {}) : args,
      env: connection?.type === 'stdio' ? params.env : (pluginSettings ?? connection?.env),
      meta,
      params,
      toolName: apiName,
    };

    // Record call start time
    const callStartTime = Date.now();
    let success = false;
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    let result: MCPToolCallResult | undefined;

    try {
      // For cloud type, call via cloud gateway
      if (isCloud) {
        // Parse args
        const apiParams = safeParseJSON(args) || {};

        // Call cloud gateway via tools market endpoint
        // Server will automatically get user access token from database
        // and format the result to MCPToolCallResult
        // Server-side also handles telemetry reporting
        result = await toolsClient.market.callCloudMcpEndpoint.mutate({
          apiParams,
          identifier,
          meta,
          toolName: apiName,
        });
      } else if (isDesktop && isStdio) {
        // For desktop and stdio, use IPC (main process)
        // Note: IPC doesn't support AbortSignal yet
        const serialized = serializeMcpIpcPayload(data);
        const serializedResult = await ensureElectronIpc().mcp.callTool(serialized as any);
        result = deserializeMcpIpcPayload(serializedResult) as any;
      } else if (isLocalHttp) {
        // Same routing as the manifest fetch: the server relay can't reach it
        const serialized = serializeMcpIpcPayload({
          args: safeParseJSON(args) ?? {},
          http: { auth: params.auth, headers: params.headers, name: params.name, url: params.url },
          toolName: apiName,
        });
        const serializedResult = await ensureElectronIpc().mcp.callTool(serialized as any);
        result = deserializeMcpIpcPayload(serializedResult) as any;
      } else {
        // For other types, use the toolsClient
        result = await toolsClient.mcp.callTool.mutate(data, { signal });
      }

      success = true;
      return result;
    } catch (error) {
      const err = error as Error;
      errorCode = 'CALL_FAILED';
      errorMessage = err.message;

      // Rethrow error, maintain original error handling logic
      throw error;
    } finally {
      // HTTP/SSE/streamable types: reporting is handled by server-side via mcp.callTool
      // Cloud type: reporting is handled by server-side via market.callCloudMcpEndpoint
      // Only report from frontend for calls that ran on this machine (desktop only)
      if (isStdio || isLocalHttp) {
        const callEndTime = Date.now();
        const callDurationMs = callEndTime - callStartTime;

        // Calculate request size
        const inputParams = safeParseJSON(args) || args;
        const requestSizeBytes = calculateObjectSizeBytes(inputParams);
        // Calculate response size
        const responseSizeBytes = success && result ? calculateObjectSizeBytes(result.state) : 0;

        // Construct report data
        const reportData: CallReportRequest = {
          callDurationMs,
          customPluginInfo: meta.customPluginInfo,
          errorCode,
          errorMessage,
          identifier,
          isCustomPlugin,
          metadata: {
            appVersion: CURRENT_VERSION,
            command: plugin.customParams?.mcp?.command,
            mcpType: plugin.customParams?.mcp?.type,
          },
          methodName: apiName,
          methodType: 'tool' as const,
          requestSizeBytes,
          responseSizeBytes,
          sessionId: topicId,
          success,
          version: meta.version,
        };

        // Asynchronously report without affecting main flow
        discoverService.reportPluginCall(reportData).catch((reportError) => {
          console.warn('Failed to report MCP tool call:', reportError);
        });
      }
    }
  }

  /**
   * Read the MCP Apps `ui://` resource (HTML view) a tool result renders with,
   * from the same server the tool ran on. Returns undefined when the tool's
   * server can't serve views from here (cloud plugins, stdio off desktop).
   */
  async readMcpAppResource(
    identifier: string,
    uri: string,
    agentId?: string,
  ): Promise<ReadResourceResult | undefined> {
    const { pluginSelectors } = await import('@/store/tool/selectors');
    const { getToolStoreState } = await import('@/store/tool/store');
    let s = getToolStoreState();

    const { connectorSelectors } = await import('@/store/tool/slices/connector/selectors');
    const connector = connectorSelectors.connectorByIdentifierForAgent(identifier, agentId)(s);

    // A conversation opened cold has not loaded the installed plugins yet, and an
    // unloaded list would send a plugin's view to the connector route. Load the
    // server's records first, as the tool call did before it ran.
    if (!connector && !pluginSelectors.isInstalledPluginsServerConfirmed(s)) {
      await s.refreshPlugins();
      s = getToolStoreState();
    }

    // Stdio connectors run on a desktop app, never on the server, so only the
    // desktop can read their view: it spawns the same command over IPC.
    if (connector?.isEnabled && connector.mcpConnectionType === 'stdio') {
      if (!isDesktop) return;

      const { lambdaClient } = await import('@/libs/trpc/client');
      // Persisted connector projections omit env secrets and may be stale.
      // This protected read retains the connector's credential ownership gate.
      const detail = await lambdaClient.connector.getForEdit.query({ id: connector.id });
      const config = detail.mcpStdioConfig;
      if (!detail.isEnabled || detail.mcpConnectionType !== 'stdio' || !config?.command) return;

      const result = await ensureElectronIpc().mcp.readUiResource(
        serializeMcpIpcPayload({
          env: config.env,
          params: {
            args: config.args ?? [],
            command: config.command,
            name: detail.identifier,
            type: 'stdio',
          },
          uri,
        }) as any,
      );
      return deserializeMcpIpcPayload(result) as ReadResourceResult;
    }

    const plugin =
      pluginSelectors.getInstalledPluginById(identifier)(s) ||
      pluginSelectors.getCustomPluginById(identifier)(s);

    // Same resolution as `invokeMcpToolCall`: the view must come from the
    // connector the tool ran on, which the server resolves for the agent.
    const isConnector = connector
      ? connector.isEnabled && !!connector.mcpServerUrl
      : !!agentId && !plugin;
    if (isConnector) {
      const { lambdaClient } = await import('@/libs/trpc/client');
      return (await lambdaClient.connector.readUiResource.query({
        agentId,
        identifier,
        uri,
      })) as ReadResourceResult;
    }

    const type = plugin?.customParams?.mcp?.type;
    if (!plugin || (type !== 'http' && type !== 'stdio')) return;

    const { params } = buildPluginMcpParams(plugin, identifier);

    // Stdio servers and localhost / LAN endpoints are only reachable from this
    // machine, so the desktop reads them over IPC instead of the server relay.
    const isLocalHttp = type === 'http' && isDesktop && isLocalOrPrivateUrl(params.url);
    if (type === 'stdio' || isLocalHttp) {
      if (!isDesktop) return;

      const input = isLocalHttp
        ? {
            http: {
              auth: params.auth,
              headers: params.headers,
              name: params.name,
              url: params.url,
            },
            uri,
          }
        : { env: params.env, params, uri };
      const result = await ensureElectronIpc().mcp.readUiResource(
        serializeMcpIpcPayload(input) as any,
      );
      return deserializeMcpIpcPayload(result) as ReadResourceResult;
    }

    // POST: the params carry the plugin's auth and headers
    return (await toolsClient.mcp.readUiResource.mutate({ params, uri })) as ReadResourceResult;
  }

  async getStreamableMcpServerManifest(
    params: {
      auth?: {
        accessToken?: string;
        token?: string;
        type: 'none' | 'bearer' | 'oauth2';
      };
      headers?: Record<string, string>;
      identifier: string;
      metadata?: CustomPluginMetadata;
      url: string;
    },
    signal?: AbortSignal,
  ) {
    // If in Desktop mode and URL is local address, use IPC (main process)
    // This avoids accessing user local services through remote server in production
    if (isDesktop && isLocalOrPrivateUrl(params.url)) {
      // Note: IPC doesn't support AbortSignal yet
      const serialized = serializeMcpIpcPayload(params);
      const serializedResult = await ensureElectronIpc().mcp.getStreamableMcpServerManifest(
        serialized as any,
      );
      return deserializeMcpIpcPayload(serializedResult) as any;
    }

    // Otherwise use toolsClient (via server relay)
    return toolsClient.mcp.getStreamableMcpServerManifest.query(params, { signal });
  }

  async getStdioMcpServerManifest(
    stdioParams: {
      args?: string[];
      command: string;
      env?: Record<string, string>;
      name: string;
    },
    metadata?: CustomPluginMetadata,
    _signal?: AbortSignal,
  ) {
    void _signal;
    // Note: IPC doesn't support AbortSignal yet
    const serialized = serializeMcpIpcPayload({ ...stdioParams, metadata });
    const serializedResult = await ensureElectronIpc().mcp.getStdioMcpServerManifest(
      serialized as any,
    );
    return deserializeMcpIpcPayload(serializedResult) as any;
  }

  /**
   * Check MCP plugin installation status
   * @param manifest MCP plugin manifest
   * @param signal AbortSignal for canceling request
   * @returns Installation check result
   */
  async checkInstallation(
    manifest: PluginManifest,
    _signal?: AbortSignal,
  ): Promise<CheckMcpInstallResult> {
    void _signal;
    // Pass all deployment options to main process for checking
    // Note: IPC doesn't support AbortSignal yet
    const serialized = serializeMcpIpcPayload({
      deploymentOptions: manifest.deploymentOptions as any,
    });
    const serializedResult = await ensureElectronIpc().mcp.validMcpServerInstallable(
      serialized as any,
    );
    return deserializeMcpIpcPayload(serializedResult) as any;
  }
}

export const mcpService = new MCPService();
