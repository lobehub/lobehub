import {
  buildMcpToolMetadata,
  getMcpAppEntrypoints,
  getMcpToolVisibility,
  isMcpToolVisibleTo,
  partitionMcpToolsForViews,
  resolveMcpUiToolMeta,
} from '@lobechat/const/mcpApp';
import type { ListMcpToolsParams } from '@lobechat/device-control';
import {
  DeviceMcpRuntime,
  type McpCallOptions,
  type MCPClientParams,
  type McpSessionOptions,
  type McpTool,
  type McpToolOutput,
  withStdioOutput,
} from '@lobechat/device-mcp';
import {
  deserializeMcpIpcPayload,
  type McpIpcPayload,
  serializeMcpIpcPayload,
} from '@lobechat/utils/mcpIpcPayload';
import { getMcpServerDescription } from '@lobechat/utils/mcpServerDescription';

import { getDesktopEnv } from '@/env';
import FileService from '@/services/fileSrv';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';
import { checkDeployOption } from './mcpInstallCheck';

const logger = createLogger('controllers:McpCtr');

/**
 * Desktop-only copy of `@lobechat/types`'s `CheckMcpInstallResult`.
 *
 * We intentionally keep it local to avoid pulling the web app's path-alias
 * expectations (e.g. `@/config/*`) into the desktop `tsrs` typecheck.
 */ interface CheckMcpInstallResult {
  allDependenciesMet?: boolean;
  allOptions?: Array<{
    allDependenciesMet?: boolean;
    connection?: {
      args?: string[];
      command?: string;
      installationMethod: string;
      packageName?: string;
      repositoryUrl?: string;
    };
    isRecommended?: boolean;
    packageInstalled?: boolean;
    systemDependencies?: Array<{
      error?: string;
      installed: boolean;
      meetRequirement: boolean;
      name: string;
      version?: string;
    }>;
  }>;
  configSchema?: any;
  connection?: {
    args?: string[];
    command?: string;
    type: 'stdio' | 'http';
    url?: string;
  };
  error?: string;
  isRecommended?: boolean;
  needsConfig?: boolean;
  packageInstalled?: boolean;
  platform: string;
  success: boolean;
  systemDependencies?: Array<{
    error?: string;
    installed: boolean;
    meetRequirement: boolean;
    name: string;
    version?: string;
  }>;
}

interface CustomPluginMetadata {
  avatar?: string;
  description?: string;
  name?: string;
}

interface GetStdioMcpServerManifestInput extends McpSessionOptions {
  args?: string[];
  command: string;
  env?: Record<string, string>;
  metadata?: CustomPluginMetadata;
  name: string;
  type?: 'stdio';
}

interface GetStreamableMcpServerManifestInput extends McpSessionOptions {
  auth?: {
    accessToken?: string;
    token?: string;
    type: 'none' | 'bearer' | 'oauth2';
  };
  headers?: Record<string, string>;
  identifier: string;
  metadata?: CustomPluginMetadata;
  url: string;
}

export interface StdioCallToolInput extends McpCallOptions {
  args: any;
  env: any;
  http?: undefined;
  params: GetStdioMcpServerManifestInput;
  toolName: string;
}

/** A call to an HTTP endpoint only this machine can reach (localhost / LAN). */
export interface HttpCallToolInput extends McpCallOptions {
  args: any;
  http: {
    auth?: { accessToken?: string; token?: string; type: 'none' | 'bearer' | 'oauth2' };
    headers?: Record<string, string>;
    name: string;
    url: string;
  };
  toolName: string;
}

export type CallToolInput = StdioCallToolInput | HttpCallToolInput;

/** List a stdio or local-network HTTP server's tools, as the server declares them. */
export type ListToolsInput = McpSessionOptions &
  (
    | { http: HttpCallToolInput['http']; stdio?: undefined }
    | { http?: undefined; stdio: GetStdioMcpServerManifestInput }
  );

/** A tool as `listTools` reports it, with its MCP Apps `visibility` when declared. */
export interface ListedMcpTool {
  description?: string;
  inputSchema: McpTool['inputSchema'];
  mcpAppMeta?: ReturnType<typeof buildMcpToolMetadata>;
  name: string;
  visibility?: string[];
}

export interface ReadUiResourceInput {
  env?: any;
  /** HTTP endpoint only this machine can reach (localhost / LAN). */
  http?: {
    auth?: { accessToken?: string; token?: string; type: 'none' | 'bearer' | 'oauth2' };
    headers?: Record<string, string>;
    name: string;
    url: string;
  };
  params?: GetStdioMcpServerManifestInput;
  uri: string;
}

type SuperJSONSerialized<T = unknown> = McpIpcPayload<T>;

/**
 * A manifest's api is what the model may call: tools whose MCP Apps visibility
 * leaves out "model" exist only for their view, which reaches them through
 * `callTool`, so they stay out of it.
 */
const toPluginApi = (tools: McpTool[]) =>
  tools.map((item) => ({
    description: item.description,
    name: item.name,
    parameters: item.inputSchema as any,
  }));

const toModelApi = (tools: McpTool[], enabled = false) =>
  toPluginApi(
    tools.filter((tool) => isMcpToolVisibleTo(getMcpToolVisibility(tool._meta, enabled), 'model')),
  );

/**
 * MCP Apps: what a plugin's views may call beyond its model-facing `api`, and
 * which `api` tools they may not, so the view-call policy finds every tool a
 * view may reach without the model seeing the view-only ones.
 */
const toMcpAppsManifestFields = (tools: McpTool[], enabled = false) => {
  const { appOnlyTools, modelOnlyToolNames } = partitionMcpToolsForViews(tools, enabled);

  return {
    ...(enabled && { mcpAppEntrypoints: getMcpAppEntrypoints(tools, true) }),
    ...(appOnlyTools.length > 0 && { mcpAppOnlyApi: toPluginApi(appOnlyTools) }),
    ...(modelOnlyToolNames.length > 0 && { mcpModelOnlyTools: modelOnlyToolNames }),
  };
};

const deserializePayload = deserializeMcpIpcPayload;

const serializePayload = serializeMcpIpcPayload;

/**
 * MCP Controller (Desktop Main Process)
 * Implements the same routes as `src/server/routers/desktop/mcp.ts`, but via IPC.
 *
 * Sessions, tool execution and media handling live in the shared
 * `@lobechat/device-mcp` runtime, which `lh connect` runs too, so a tunneled
 * call behaves the same on either device host.
 */
export default class McpCtr extends ControllerModule {
  static override readonly groupName = 'mcp';

  private runtimeInstance?: DeviceMcpRuntime;

  private get runtime(): DeviceMcpRuntime {
    this.runtimeInstance ??= new DeviceMcpRuntime({
      clientName: 'lobehub-desktop-mcp-client',
      getMediaUrl: (key) => this.fileService.getFileHTTPURL(key),
      logger,
      toolTimeoutMs: getDesktopEnv().MCP_TOOL_TIMEOUT,
      uploadMedia: (media) => this.uploadMcpMedia(media),
    });
    return this.runtimeInstance;
  }

  /**
   * App shutdown hook: disconnect every pooled stdio session so no MCP
   * subprocess outlives the desktop process. Electron does not await
   * Promise-returning listeners; the runtime initiates every disconnect
   * synchronously before its first await.
   */
  async beforeAppReady() {
    const { app } = await import('electron');
    app.once('will-quit', () => {
      void this.disposeAllPooledClients();
    });
  }

  private async disposeAllPooledClients(): Promise<void> {
    await this.runtimeInstance?.dispose();
  }

  private get fileService() {
    return this.app.getService(FileService);
  }

  private async uploadMcpMedia({
    base64,
    filename,
    hash,
    mimeType,
    path,
  }: Parameters<ConstructorParameters<typeof DeviceMcpRuntime>[0]['uploadMedia']>[0]) {
    const { metadata } = await this.fileService.uploadFile({
      content: base64,
      filename,
      hash,
      path,
      type: mimeType,
    });

    return metadata.path;
  }

  @IpcMethod()
  async getStdioMcpServerManifest(payload: SuperJSONSerialized<GetStdioMcpServerManifestInput>) {
    const input = deserializePayload<GetStdioMcpServerManifestInput>(payload);
    const params: MCPClientParams = {
      args: input.args || [],
      command: input.command,
      env: input.env,
      name: input.name,
      type: 'stdio',
    };

    let client: Awaited<ReturnType<DeviceMcpRuntime['acquireClient']>> | undefined;
    try {
      client = await this.runtime.acquireClient(params, { mcpApps: input.mcpApps });
      const pooled = client;
      // Lease for the manifest refresh too: a concurrent stale-session
      // eviction must not disconnect underneath this pending request.
      const manifest = await this.runtime.withClientLease(pooled, () => pooled.listManifests());
      const identifier = input.name;

      const api = toModelApi(manifest.tools || [], input.mcpApps);

      return serializePayload({
        api,
        identifier,
        meta: {
          avatar: input.metadata?.avatar || 'MCP_AVATAR',
          description:
            input.metadata?.description ||
            getMcpServerDescription(identifier, { ...manifest, tools: api }),
          title: input.metadata?.name || identifier,
        },
        ...manifest,
        ...toMcpAppsManifestFields(manifest.tools || [], input.mcpApps),
        mcpParams: params,
        type: 'mcp' as any,
      });
    } catch (error) {
      // The pooled session this manifest refresh ran on is stale/broken —
      // evict it so the next refresh starts fresh instead of reacquiring
      // the same dead session forever. Identity-guarded: a concurrent
      // recreate must not be disconnected.
      await this.runtime.evictClient(params, client);
      const enhanced = await withStdioOutput(error);
      if (enhanced !== error)
        logger.error('getStdioMcpServerManifest failed with STDIO logs:', enhanced);
      throw enhanced;
    }
  }

  @IpcMethod()
  async getStreamableMcpServerManifest(
    payload: SuperJSONSerialized<GetStreamableMcpServerManifestInput>,
  ) {
    const input = deserializePayload<GetStreamableMcpServerManifestInput>(payload);
    const params: MCPClientParams = {
      auth: input.auth,
      headers: input.headers,
      name: input.identifier,
      type: 'http',
      url: input.url,
    };

    const client = await this.runtime.createClient(params, { mcpApps: input.mcpApps });
    try {
      const tools = await client.listTools();
      const api = toModelApi(tools, input.mcpApps);
      const identifier = input.identifier;

      return serializePayload({
        api,
        identifier,
        ...toMcpAppsManifestFields(tools, input.mcpApps),
        mcpParams: params,
        meta: {
          avatar: input.metadata?.avatar || 'MCP_AVATAR',
          description:
            input.metadata?.description ||
            getMcpServerDescription(identifier, { tools: api }, { includeToolExample: true }),
          title: identifier,
        },
        type: 'mcp' as any,
      });
    } finally {
      await client.disconnect();
    }
  }

  /**
   * Every tool a stdio or local-network HTTP server lists, including the ones
   * only its views may call. A connector syncs this full list, since a view's
   * call must find its tool synced; the model's manifest filters it later.
   */
  @IpcMethod()
  async listTools(payload: SuperJSONSerialized<ListToolsInput>) {
    const input = deserializePayload<ListToolsInput>(payload);
    const toListed = (tools: McpTool[]): ListedMcpTool[] =>
      tools.map((tool) => ({
        description: tool.description,
        inputSchema: tool.inputSchema,
        name: tool.name,
        visibility: getMcpToolVisibility(tool._meta),
        ...(input.mcpApps && {
          mcpAppMeta: buildMcpToolMetadata(resolveMcpUiToolMeta(tool._meta, false).visibility, {
            ...resolveMcpUiToolMeta(tool._meta),
            entrypoints: resolveMcpUiToolMeta(tool._meta).entrypoints ?? [],
            threadEntry: getMcpAppEntrypoints([tool], true)[0],
          }),
        }),
      }));

    const params: MCPClientParams = input.http
      ? { ...input.http, type: 'http' }
      : {
          args: input.stdio.args || [],
          command: input.stdio.command,
          env: input.stdio.env,
          name: input.stdio.name,
          type: 'stdio',
        };
    return serializePayload(
      toListed(await this.runtime.listTools(params, { mcpApps: input.mcpApps })),
    );
  }

  /**
   * The device-gateway `listMcpTools` RPC: the cloud server can't reach this
   * MCP server (stdio, an endpoint on this machine's network, or one the user
   * set to connect through this device), so it asks this machine for the tool
   * list and maps it as it maps its own listings. The tools go back as listed.
   * Listed by the same runtime the tunneled calls run on.
   */
  async listToolsForGateway({ mcpApps, params }: ListMcpToolsParams): Promise<McpTool[]> {
    const client: MCPClientParams =
      params.type === 'http'
        ? {
            auth: params.auth,
            headers: params.headers,
            name: params.name,
            type: 'http',
            url: params.url,
          }
        : {
            args: params.args ?? [],
            command: params.command,
            env: params.env,
            name: params.name,
            type: 'stdio',
          };
    return this.runtime.listTools(client, { mcpApps });
  }

  @IpcMethod()
  async callTool(payload: SuperJSONSerialized<CallToolInput>) {
    const input = deserializePayload<CallToolInput>(payload);
    if ('http' in input && input.http) {
      return serializePayload(
        await this.runHttpMcpTool(input.http, input.toolName, input.args, {
          fromApp: input.fromApp,
          fromEntrypoint: input.fromEntrypoint,
          mcpApps: input.mcpApps,
        }),
      );
    }
    return serializePayload(await this.runStdioMcpTool(input as StdioCallToolInput));
  }

  /**
   * Read an MCP Apps `ui://` resource from a stdio or local-network HTTP
   * server, so the chat can render a tool result's interactive view.
   *
   * Unlike the web routes, not gated by the `mcp_apps` flag: the main process
   * has no per-user flags, and the renderer only asks while the flag is on.
   */
  /**
   * Read an MCP Apps `ui://` resource from a stdio or local-network HTTP
   * server, so the chat can render a tool result's interactive view.
   *
   * Unlike the web routes, not gated by the `mcp_apps` flag: the main process
   * has no per-user flags, and the renderer only asks while the flag is on.
   */
  @IpcMethod()
  async readUiResource(payload: SuperJSONSerialized<ReadUiResourceInput>) {
    const input = deserializePayload<ReadUiResourceInput>(payload);
    if (!input.uri?.startsWith('ui://')) throw new Error('Only ui:// resources can be read');

    let params: MCPClientParams;
    if (input.http) {
      params = { ...input.http, type: 'http' };
    } else if (input.params) {
      params = {
        args: input.params.args || [],
        command: input.params.command,
        env: input.env,
        name: input.params.name,
        type: 'stdio',
      };
    } else {
      throw new Error('Missing MCP server params');
    }

    return serializePayload(await this.runtime.readUiResource(params, input.uri));
  }

  /**
   * Core stdio MCP tool execution, shared by the renderer IPC path
   * ({@link callTool}) and the device-gateway tunnel (GatewayConnectionCtr,
   * which runs MCP calls forwarded from the cloud server). Returns the plain
   * result envelope; callers serialize as needed. Throws on failure so each
   * caller can shape its own error response.
   */
  async runStdioMcpTool(input: StdioCallToolInput): Promise<McpToolOutput> {
    return this.runtime.runTool(
      {
        args: input.params.args || [],
        command: input.params.command,
        env: input.env,
        name: input.params.name,
        type: 'stdio',
      },
      input.toolName,
      input.args,
      { fromApp: input.fromApp, fromEntrypoint: input.fromEntrypoint, mcpApps: input.mcpApps },
    );
  }

  /**
   * HTTP counterpart of {@link runStdioMcpTool} for the device-gateway tunnel:
   * the cloud server forwards calls to localhost / LAN MCP endpoints that only
   * this machine's network can reach, with the (server-decrypted) auth attached.
   */
  async runHttpMcpTool(
    input: {
      auth?: { accessToken?: string; token?: string; type: 'none' | 'bearer' | 'oauth2' };
      headers?: Record<string, string>;
      name: string;
      url: string;
    },
    toolName: string,
    rawArgs: unknown,
    options: McpCallOptions = {},
  ): Promise<McpToolOutput> {
    return this.runtime.runTool(
      { auth: input.auth, headers: input.headers, name: input.name, type: 'http', url: input.url },
      toolName,
      rawArgs,
      options,
    );
  }

  @IpcMethod()
  async validMcpServerInstallable(
    payload: SuperJSONSerialized<{
      deploymentOptions: any[];
    }>,
  ) {
    const input = deserializePayload<{ deploymentOptions: any[] }>(payload);
    try {
      const options = input.deploymentOptions || [];
      const results = [];

      for (const option of options) {
        results.push(await checkDeployOption(option));
      }

      const recommendedResult = results.find((r: any) => r.isRecommended && r.allDependenciesMet);
      const firstInstallableResult = results.find((r: any) => r.allDependenciesMet);
      const bestResult = recommendedResult || firstInstallableResult || results[0];

      const checkResult: CheckMcpInstallResult = {
        ...bestResult,
        allOptions: results as any,
        platform: process.platform,
        success: true,
      };

      if (bestResult?.needsConfig) {
        checkResult.needsConfig = true;
        checkResult.configSchema = bestResult.configSchema;
      }

      return serializePayload(checkResult);
    } catch (error) {
      return serializePayload({
        error:
          error instanceof Error
            ? error.message
            : 'Unknown error when checking MCP plugin installation status',
        platform: process.platform,
        success: false,
      });
    }
  }
}
