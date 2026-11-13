import { CURRENT_VERSION, isDesktop } from '@lobechat/const';
import {
  getMcpServerFingerprint,
  isSyncedMcpToolVisibleTo,
  type McpServerAddress,
} from '@lobechat/const/mcpApp';
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
import { omit } from 'es-toolkit/compat';

import { type MCPToolCallResult } from '@/libs/mcp';
import { renderMcpArgs, renderMcpUrlTemplate } from '@/libs/mcp/urlTemplate';
import { getMCPConnectionErrorType } from '@/libs/mcp/utils';
import { toolsClient } from '@/libs/trpc/client';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';
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

/** A tool a local MCP server lists, as the desktop main process reports it. */
export interface LocalMcpTool {
  description?: string;
  inputSchema?: Record<string, unknown>;
  name: string;
  /** The tool's MCP Apps `_meta.ui.visibility`, when it declares one. */
  visibility?: string[];
}

/**
 * IPC and cloud-gateway calls can't be cancelled once sent, so a request
 * cancelled during the awaits before them must stop here.
 */
const throwIfAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) return;

  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The tool call was cancelled', 'AbortError');
};

/**
 * A view this machine's MCP process (stdio, localhost / LAN) marked on its
 * result can only be served here, where the view and its calls run: record
 * which desktop that is, so another one falls back to the plain result.
 */
const markLocalView = async <T>(result: T): Promise<T> => {
  const state = (result as { state?: { mcpApp?: { deviceId?: string } } } | undefined)?.state;
  if (!state?.mcpApp) return result;

  const { getElectronStoreState } = await import('@/store/electron');
  const deviceId = await getElectronStoreState().resolveGatewayDeviceId();
  // Unmarked would read as a view any client can serve: offer none instead
  if (deviceId) state.mcpApp.deviceId = deviceId;
  else delete state.mcpApp;

  return result;
};

/**
 * Whether `address` is the MCP server a view came from (`server`, a
 * `getMcpServerFingerprint`). A view is read, and its calls run, on no other.
 */
const isViewServer = async (server: string | undefined, address: McpServerAddress) =>
  !!server && (await getMcpServerFingerprint(address)) === server;

const VIEW_SERVER_MOVED = 'This view came from another server than the tool reaches now';

/**
 * The params, of a plugin's two current ones, that reach the server a view came
 * from: as configured here (its settings merged in), or as the server's runtime
 * ran it (`manifest.mcpParams`). The view is read, and calls, with exactly those.
 */
const pickViewServerParams = async (
  server: string | undefined,
  plugin: { manifest?: unknown },
  configured: any,
): Promise<any | undefined> => {
  const runtime = (plugin.manifest as { mcpParams?: { type?: string } } | undefined)?.mcpParams;
  for (const params of [configured, runtime]) {
    if (params?.type !== 'http' && params?.type !== 'stdio') continue;
    if (await isViewServer(server, params)) return params;
  }
  return undefined;
};
const VIEW_SITE_MISMATCH = "This view's server runs elsewhere than this call would";

/** The user's `mcp_apps` flag: whether sessions on this machine announce MCP Apps. */
const isMcpAppsOn = () => {
  const state = getServerConfigStoreState();
  return !!state && serverConfigSelectors.enableMcpApps(state);
};

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
    // Settings the URL asks for (`{{KEY}}`) go into the URL, matching the install
    // that produced `manifest.mcpParams`; the rest are headers
    const rendered = renderMcpUrlTemplate(connection.url ?? '', pluginSettings);
    if (connection.url) params.url = rendered.url;
    const headers = {
      ...connection.headers,
      ...(pluginSettings && omit(pluginSettings, rendered.usedKeys)),
    };
    // Left out when empty, as the runtime's manifest params leave it: MCP
    // sessions are cached by these params, so `{}` would open a second one
    if (Object.keys(headers).length > 0) params.headers = headers;
  }

  if (connection?.type === 'stdio') {
    // Match the install that produced `manifest.mcpParams`: args get the settings they ask for
    if (connection.args) params.args = renderMcpArgs(connection.args, pluginSettings);
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
      fromMcpApp,
      onThisDevice,
      server,
      signal,
      topicId,
    }: {
      /** Resolve connectors the way this agent's conversation does (agent-owned first). */
      agentId?: string;
      /**
       * The call is an MCP App view's `tools/call`, not the model's:
       * - only tools whose `_meta.ui.visibility` includes "app" run, which the
       *   process holding the MCP session (server or desktop main) checks;
       * - on desktop, servers only this machine can reach (stdio connectors,
       *   localhost / LAN http plugins) run over IPC whether or not a device
       *   gateway is configured, as the view's HTML was read the same way.
       *   Conversation calls keep their existing route.
       */
      fromMcpApp?: boolean;
      /**
       * With `fromMcpApp`: the view's result came from this desktop's own MCP
       * process (it carries this device's id), so its calls run there too;
       * otherwise on the server. A URL alone can't tell a server-side
       * `localhost` from this machine's.
       */
      onThisDevice?: boolean;
      /** With `fromMcpApp`: the server the view came from; its calls reach no other. */
      server?: string;
      signal?: AbortSignal;
      topicId?: string;
    },
  ) {
    await discoverService.safeInjectMPToken();

    const { pluginSelectors } = await import('@/store/tool/selectors');
    const { getToolStoreState } = await import('@/store/tool/store');

    const s = getToolStoreState();
    const { identifier, arguments: args, apiName } = payload;
    // Calls run on this machine announce MCP Apps only under the user's flag
    const mcpApps = isMcpAppsOn();

    // Connector-first: HTTP connectors use their server-held credentials.
    // Standalone desktop stdio connectors use local IPC; configured device
    // gateways keep the existing server route for conversation calls.
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
      const runsHere =
        connector &&
        isDesktop &&
        connector.mcpConnectionType === 'stdio' &&
        (fromMcpApp || getServerConfigStoreState()?.serverConfig.deviceGatewayConfigured === false);
      // A view's calls run where its result was produced
      if (fromMcpApp && !!runsHere !== !!onThisDevice) throw new Error(VIEW_SITE_MISMATCH);
      if (runsHere) {
        // Persisted connector projections omit env secrets and may be stale.
        // This protected read retains the connector's credential ownership gate.
        const detail = await lambdaClient.connector.getForEdit.query({ id: connector.id });
        if (!detail.isEnabled) throw new Error('Connector is disabled');
        const tool = detail.tools.find((item) => item.toolName === apiName);
        if (!tool || tool.permission === 'disabled') {
          throw new Error(`Tool '${apiName}' is unavailable or disabled for this connector`);
        }
        if (!fromMcpApp && !isSyncedMcpToolVisibleTo(tool, 'model')) {
          throw new Error(`Tool '${apiName}' can only be called from its interactive view`);
        }
        const config = detail.mcpStdioConfig;
        if (detail.mcpConnectionType !== 'stdio' || !config?.command) {
          throw new Error('Connector does not have a stdio command configured');
        }
        if (
          fromMcpApp &&
          !(await isViewServer(server, {
            args: config.args ?? [],
            command: config.command,
            env: config.env,
            type: 'stdio',
          }))
        ) {
          throw new Error(VIEW_SERVER_MOVED);
        }
        throwIfAborted(signal);
        const result = await ensureElectronIpc().mcp.callTool(
          serializeMcpIpcPayload({
            args: safeParseJSON(args) ?? {},
            env: config.env,
            ...(fromMcpApp && { fromApp: true }),
            mcpApps,
            params: {
              args: config.args ?? [],
              command: config.command,
              name: detail.identifier,
              type: 'stdio',
            },
            toolName: apiName,
          }),
        );
        return markLocalView(deserializeMcpIpcPayload<MCPToolCallResult>(result));
      }
      try {
        return (await lambdaClient.connector.callTool.mutate(
          {
            agentId,
            args,
            // The server checks the view's server against the connector it resolves
            ...(fromMcpApp && { fromApp: true, server }),
            identifier,
            toolName: apiName,
          },
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
    const configured = buildPluginMcpParams(plugin, identifier);
    const { pluginSettings } = configured;

    const isStdio = plugin?.customParams?.mcp?.type === 'stdio';
    const isCloud = plugin?.customParams?.mcp?.type === 'cloud';
    // A view's calls reach the server its result came from, never another
    // (cloud servers refuse view calls below)
    let params = configured.params;
    if (fromMcpApp && !isCloud) {
      params = await pickViewServerParams(server, plugin, configured.params);
      if (!params) throw new Error(VIEW_SERVER_MOVED);
    }
    // A view's call to an http server runs where its result was produced: over
    // IPC when this desktop's process produced it (a localhost / LAN endpoint
    // only it reaches), else on the server, which may reach its own LAN
    const isLocalHttp =
      !!fromMcpApp && isDesktop && plugin?.customParams?.mcp?.type === 'http' && !!onThisDevice;
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
      ...(fromMcpApp && { fromApp: true }),
      meta,
      params,
      toolName: apiName,
    };

    // Cloud servers refuse view calls below
    // Stdio runs only on this desktop, which then marked the result as its own
    if (fromMcpApp && isStdio && !(isDesktop && onThisDevice)) {
      throw new Error(VIEW_SITE_MISMATCH);
    }

    // Before the timing starts: a call cancelled here never ran, so isn't reported
    throwIfAborted(signal);

    // Record call start time
    const callStartTime = Date.now();
    let success = false;
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    let result: MCPToolCallResult | undefined;

    try {
      // Cloud servers render no views, and their gateway can't check visibility
      if (isCloud && fromMcpApp) {
        throw new Error(`Tool '${apiName}' can't be called from an interactive view`);
      }

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
        const serialized = serializeMcpIpcPayload({ ...data, mcpApps });
        const serializedResult = await ensureElectronIpc().mcp.callTool(serialized as any);
        result = await markLocalView(deserializeMcpIpcPayload(serializedResult) as any);
      } else if (isLocalHttp) {
        // Same routing as the manifest fetch: the server relay can't reach it
        const serialized = serializeMcpIpcPayload({
          args: safeParseJSON(args) ?? {},
          fromApp: true,
          http: { auth: params.auth, headers: params.headers, name: params.name, url: params.url },
          mcpApps,
          toolName: apiName,
        });
        const serializedResult = await ensureElectronIpc().mcp.callTool(serialized as any);
        result = await markLocalView(deserializeMcpIpcPayload(serializedResult) as any);
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
   * from the same server the tool ran on: `server` names it
   * (`getMcpServerFingerprint`), and the identifier must still resolve to it.
   * Returns undefined when it doesn't, or when that server can't serve views
   * from here (cloud plugins, stdio off desktop).
   */
  async readMcpAppResource(
    identifier: string,
    uri: string,
    {
      agentId,
      onThisDevice = false,
      server,
    }: {
      agentId?: string;
      /**
       * The result came from this desktop's own MCP process (it carries this
       * device's id): read the view there, over IPC. Otherwise it came from the
       * server, which reads it. Never the other one: a URL can't tell a
       * server-side `localhost` from this machine's.
       */
      onThisDevice?: boolean;
      server?: string;
    },
  ): Promise<ReadResourceResult | undefined> {
    // A result that doesn't name its server can't be matched to one
    if (!server) return;
    const reaches = (address: McpServerAddress) => isViewServer(server, address);

    const { pluginSelectors } = await import('@/store/tool/selectors');
    const { getToolStoreState } = await import('@/store/tool/store');
    let s = getToolStoreState();

    // An agent's own connectors (e.g. a stdio one only it has) may not be loaded
    // in a conversation opened cold; without them the view would be read from
    // the base connector, or sent to the server route. If they can't be loaded,
    // the read fails, so its fetcher retries rather than settling on no view;
    // it is never read from another server meanwhile.
    if (agentId) {
      await s.ensureConfirmedConnectors(agentId);
      s = getToolStoreState();
    }

    const { connectorSelectors } = await import('@/store/tool/slices/connector/selectors');
    const connector = connectorSelectors.connectorByIdentifierForAgent(identifier, agentId)(s);
    // Same test as `invokeMcpToolCall`: only an enabled connector with its own
    // endpoint serves the view. Any other (e.g. the endpoint-less row a plugin's
    // tools are synced to) leaves it to the plugin.
    const connectorServes =
      !!connector?.isEnabled &&
      (!!connector.mcpServerUrl || connector.mcpConnectionType === 'stdio');

    // A conversation opened cold has not loaded the installed plugins yet, and an
    // unloaded list would lose a plugin's view or send it to the connector route.
    // Load the server's records first, as the tool call did before it ran.
    if (!connectorServes && !pluginSelectors.isInstalledPluginsServerConfirmed(s)) {
      await s.refreshPlugins();
      s = getToolStoreState();
    }

    // Stdio connectors run on a desktop app, never on the server, so only the
    // desktop can read their view: it spawns the same command over IPC.
    if (connectorServes && connector?.mcpConnectionType === 'stdio') {
      if (!isDesktop || !onThisDevice) return;

      const { lambdaClient } = await import('@/libs/trpc/client');
      // Persisted connector projections omit env secrets and may be stale.
      // This protected read retains the connector's credential ownership gate.
      const detail = await lambdaClient.connector.getForEdit.query({ id: connector.id });
      const config = detail.mcpStdioConfig;
      if (!detail.isEnabled || detail.mcpConnectionType !== 'stdio' || !config?.command) return;
      if (
        !(await reaches({
          args: config.args ?? [],
          command: config.command,
          env: config.env,
          type: 'stdio',
        }))
      ) {
        return;
      }

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

    // Same resolution as `invokeMcpToolCall`: the view comes from the connector
    // the tool ran on. The agent's lists are loaded by now, so an identifier
    // with no connector here has none on the server either.
    if (connectorServes) {
      if (onThisDevice) return;
      const { lambdaClient } = await import('@/libs/trpc/client');
      // The server checks `server` against the connector it resolves
      return (await lambdaClient.connector.readUiResource.query({
        agentId,
        identifier,
        server,
        uri,
      })) as ReadResourceResult;
    }

    const type = plugin?.customParams?.mcp?.type;
    if (!plugin || (type !== 'http' && type !== 'stdio')) return;

    const params = await pickViewServerParams(
      server,
      plugin,
      buildPluginMcpParams(plugin, identifier).params,
    );
    if (!params) return;

    // A result this desktop's process produced (stdio, or a localhost / LAN
    // endpoint only it reaches) has its view read here over IPC; any other on
    // the server relay. Stdio never runs on the server.
    const isLocalHttp = type === 'http' && onThisDevice;
    if (type === 'stdio' || isLocalHttp) {
      if (!isDesktop || !onThisDevice) return;

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
      // With MCP Apps on, the tools only views call are listed and kept too
      const serialized = serializeMcpIpcPayload({ ...params, mcpApps: isMcpAppsOn() });
      const serializedResult = await ensureElectronIpc().mcp.getStreamableMcpServerManifest(
        serialized as any,
      );
      return deserializeMcpIpcPayload(serializedResult) as any;
    }

    // Otherwise use toolsClient (via server relay)
    return toolsClient.mcp.getStreamableMcpServerManifest.query(params, { signal });
  }

  /**
   * Every tool a server only this machine can reach (stdio or local-network
   * HTTP) lists, including view-only ones, with each tool's MCP Apps
   * visibility. Desktop only.
   */
  async listLocalMcpTools(
    params:
      | {
          http: {
            auth?: { accessToken?: string; token?: string; type: 'none' | 'bearer' | 'oauth2' };
            headers?: Record<string, string>;
            name: string;
            url: string;
          };
        }
      | { stdio: { args?: string[]; command: string; env?: Record<string, string>; name: string } },
  ): Promise<LocalMcpTool[]> {
    const serializedResult = await ensureElectronIpc().mcp.listTools(
      // With MCP Apps on, a server may list its view-only tools only then
      serializeMcpIpcPayload({ ...params, mcpApps: isMcpAppsOn() }) as any,
    );
    return deserializeMcpIpcPayload<LocalMcpTool[]>(serializedResult);
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
    // With MCP Apps on, the tools only views call are listed and kept too
    const serialized = serializeMcpIpcPayload({ ...stdioParams, mcpApps: isMcpAppsOn(), metadata });
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
