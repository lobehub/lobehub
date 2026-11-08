import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  getMcpServerFingerprint,
  getMcpToolVisibility,
  isMcpToolVisibleTo,
  lacksUiResourceMeta,
  partitionMcpToolsForViews,
  withListingUiMeta,
} from '@lobechat/const/mcpApp';
import {
  deserializeMcpIpcPayload,
  type McpIpcPayload,
  serializeMcpIpcPayload,
} from '@lobechat/utils/mcpIpcPayload';
import { getMcpServerDescription } from '@lobechat/utils/mcpServerDescription';

import FileService from '@/services/fileSrv';
import { createLogger } from '@/utils/logger';

import type { MCPClient } from '../libs/mcp/client';
import {
  isDeadTransportError,
  isStaleSessionError,
  serializeMcpClientParams,
} from '../libs/mcp/sessionGuards';
import type {
  AudioContent,
  ImageContent,
  MCPClientParams,
  McpTool,
  ResourceContent,
  ToolCallContent,
  ToolCallResult,
} from '../libs/mcp/types';
import { ControllerModule, IpcMethod } from './index';
import { checkDeployOption } from './mcpInstallCheck';

const logger = createLogger('controllers:McpCtr');
const loadMcpClient = () => import('../libs/mcp/client');

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

interface McpSessionOptions {
  /** Announce MCP Apps on the session: the user has the `mcp_apps` flag. */
  mcpApps?: boolean;
}

/** How a tool call runs: whether a view made it, and whether MCP Apps are on. */
interface McpCallOptions extends McpSessionOptions {
  /** An MCP App view's `tools/call`: only tools visible to the app run. */
  fromApp?: boolean;
}

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

const toModelApi = (tools: McpTool[]) =>
  toPluginApi(
    tools.filter((tool) => isMcpToolVisibleTo(getMcpToolVisibility(tool._meta), 'model')),
  );

/**
 * MCP Apps: what a plugin's views may call beyond its model-facing `api`, and
 * which `api` tools they may not, so the view-call policy finds every tool a
 * view may reach without the model seeing the view-only ones.
 */
const toMcpAppsManifestFields = (tools: McpTool[]) => {
  const { appOnlyTools, modelOnlyToolNames } = partitionMcpToolsForViews(tools);

  return {
    ...(appOnlyTools.length > 0 && { mcpAppOnlyApi: toPluginApi(appOnlyTools) }),
    ...(modelOnlyToolNames.length > 0 && { mcpModelOnlyTools: modelOnlyToolNames }),
  };
};

const deserializePayload = deserializeMcpIpcPayload;

const serializePayload = serializeMcpIpcPayload;

const safeParseToRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return parsed as Record<string, unknown>;
    } catch {
      // ignore
    }
  }
  return {};
};

const MEDIA_UPLOAD_CONFIG = {
  audio: {
    defaultExtension: 'mp3',
    defaultMimeType: 'audio/mpeg',
    pathnameSegment: 'audios',
  },
  image: {
    defaultExtension: 'png',
    defaultMimeType: 'image/png',
    pathnameSegment: 'images',
  },
} as const;

type MediaContentType = keyof typeof MEDIA_UPLOAD_CONFIG;

const PREFERRED_MIME_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'image/svg+xml': 'svg',
};

const normalizeMimeType = (mimeType: string | undefined, mediaType: MediaContentType) => {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase();
  return normalized || MEDIA_UPLOAD_CONFIG[mediaType].defaultMimeType;
};

const getMediaContentType = (mimeType: string | undefined): MediaContentType | undefined => {
  const normalized = mimeType?.split(';')[0]?.trim().toLowerCase();
  if (normalized?.startsWith('image/')) return 'image';
  if (normalized?.startsWith('audio/')) return 'audio';
};

const getFileExtensionFromMimeType = (mimeType: string, mediaType: MediaContentType) => {
  const [, subtype = ''] = mimeType.split('/');
  const sanitizedSubtype = subtype
    .split('+')[0]
    .replaceAll(/[^a-z0-9]/gi, '')
    .toLowerCase();

  return (
    PREFERRED_MIME_EXTENSIONS[mimeType] ||
    sanitizedSubtype ||
    MEDIA_UPLOAD_CONFIG[mediaType].defaultExtension
  );
};

const todayShard = () => new Date().toISOString().split('T')[0];

const toMarkdown = async (
  blocks: ToolCallContent[] | null | undefined,
  getHTTPURL: (key: string) => Promise<string>,
) => {
  if (!blocks) return '';

  const parts = await Promise.all(
    blocks.map(async (item) => {
      switch (item.type) {
        case 'text': {
          return item.text;
        }
        case 'image': {
          const url = await getHTTPURL(item.data);
          return `![](${url})`;
        }
        case 'audio': {
          const url = await getHTTPURL(item.data);
          return `<resource type="${item.type}" url="${url}" />`;
        }
        case 'resource': {
          return `<resource type="${item.type}">${JSON.stringify(item.resource)}</resource>`;
        }
        default: {
          return '';
        }
      }
    }),
  );

  return parts.filter(Boolean).join('\n\n');
};

/**
 * MCP Controller (Desktop Main Process)
 * Implements the same routes as `src/server/routers/desktop/mcp.ts`, but via IPC.
 */
export default class McpCtr extends ControllerModule {
  static override readonly groupName = 'mcp';

  /**
   * Long-lived MCP client pool keyed by serialized connection params.
   *
   * Stateful stdio MCP servers (e.g. IDA's `ida-mcp`: `open_database` sets a
   * current database that later `execute_python` calls depend on) lose their
   * in-process state when the session is torn down between tool calls. The
   * cloud-side MCPService already caches clients; the desktop / device-tunnel
   * path used to spawn a fresh process per call and kill it right after
   * (`finally disconnect()`), silently dropping all server-side state. We now
   * reuse one session per unique connection params, and only rebuild it when
   * a call fails.
   */
  private mcpClientPool = new Map<string, MCPClient>();
  /** The pool key each client was created under, so eviction finds its own entry. */
  private mcpClientKeys = new WeakMap<MCPClient, string>();
  private mcpClientInitialization?: Map<string, Promise<MCPClient>>;

  /**
   * Idle-reap policy for the pool: sessions untouched for longer than this
   * are disconnected and dropped at the next acquire/dispose sweep.
   *
   * Rationale: stdio subprocesses are cheap to respawn but leak when kept
   * forever — a changed token/env/command produces a NEW cache key while the
   * old entry stays connected for the life of the desktop process, so a
   * long-running session could accumulate every obsolete client. The TTL is
   * deliberately long (30 min ≫ any realistic think-turn between tool calls)
   * so actively used stateful sessions are never reaped mid-workflow: every
   * acquire refreshes lastUsedAt.
   */
  private static readonly MCP_POOL_IDLE_TTL_MS = 30 * 60 * 1000;

  private mcpClientLastUsedAt = new Map<string, number>();

  // In-flight call tracking: eviction and idle reaping are deferred while a
  // client holds any lease; release performs a pending eviction disconnect.
  private mcpClientLeases = new Map<MCPClient, number>();
  private mcpClientPendingDisconnect = new Set<MCPClient>();

  /**
   * App shutdown hook: disconnect every pooled stdio session so no MCP
   * subprocess outlives the desktop process. Electron does not await
   * Promise-returning listeners: every disconnect is initiated
   * synchronously before the first await (never throws).
   */
  async beforeAppReady() {
    const { app } = await import('electron');
    app.once('will-quit', () => {
      void this.disposeAllPooledClients();
    });
  }

  private async disposeAllPooledClients(): Promise<void> {
    const entries = [...this.mcpClientPool.entries()];
    this.mcpClientPool.clear();
    this.mcpClientLastUsedAt.clear();
    const teardowns = entries.map(([, client]) =>
      client.disconnect().catch((error: unknown) => {
        logger.warn('Failed to disconnect MCP client on dispose:', error);
      }),
    );
    await Promise.all(teardowns);
  }

  private get fileService() {
    return this.app.getService(FileService);
  }

  /**
   * Disconnect and drop every pooled session that has been idle for longer
   * than the TTL. Never throws.
   */
  private async reapIdleClients(): Promise<void> {
    const now = Date.now();
    for (const [key, client] of this.mcpClientPool) {
      const lastUsed = this.mcpClientLastUsedAt.get(key) ?? 0;
      if (now - lastUsed < McpCtr.MCP_POOL_IDLE_TTL_MS) continue;
      // A session with active in-flight calls is still working: disconnecting
      // it mid-call would kill a valid long-running tool invocation (the
      // idle clock only refreshes at acquisition, not during the call).
      if (this.mcpClientLeases.has(client)) continue;
      this.mcpClientPool.delete(key);
      this.mcpClientLastUsedAt.delete(key);
      try {
        await client.disconnect();
      } catch (error) {
        logger.warn('Failed to reap idle MCP client:', error);
      }
    }
  }

  /**
   * Return a pooled client for the given params, creating (and caching) a new
   * one when the pool has no healthy entry. Callers must NOT disconnect the
   * returned client — pooled sessions outlive a single tool call.
   */
  private async acquireClient(
    params: MCPClientParams,
    { mcpApps = false }: McpSessionOptions = {},
  ): Promise<MCPClient> {
    // Sessions that announce MCP Apps and ones that don't are pooled apart
    const key = `${serializeMcpClientParams(params)}${mcpApps ? '#mcp-apps' : ''}`;

    // Every acquire refreshes the session's idle clock (fire-and-forget —
    // reaping must never delay or fail the tool call it runs alongside).
    this.mcpClientLastUsedAt.set(key, Date.now());
    void this.reapIdleClients().catch(() => {});

    const cached = this.mcpClientPool.get(key);
    if (cached) return cached;

    // Single-flight per key: concurrent manifest discovery + tool call on the
    // same uncached params must share one initialization, not spawn two
    // processes where the later map write silently replaces the first
    // (stranding whatever state the losing client had established).
    const inFlight = this.mcpClientInitialization?.get(key);
    if (inFlight) return inFlight;

    const creating = this.createClient(params, { mcpApps })
      .then((client) => {
        this.mcpClientKeys.set(client, key);
        this.mcpClientPool.set(key, client);
        this.mcpClientLastUsedAt.set(key, Date.now());
        return client;
      })
      .catch((error) => {
        // The acquire-time clock is an orphan when creation fails: failed
        // configs (serialized keys contain env values) must not accumulate.
        this.mcpClientLastUsedAt.delete(key);
        throw error;
      })
      .finally(() => {
        this.mcpClientInitialization?.delete(key);
      });
    (this.mcpClientInitialization ??= new Map()).set(key, creating);
    return creating;
  }

  /**
   * Run `fn` while holding a lease: eviction and idle reaping are deferred
   * while any lease is active. The last release refreshes the idle clock
   * (a call may outlast the TTL — the session is fresh the moment its work
   * ends, not when it started) and then performs any pending disconnect.
   */
  private async withClientLease<T>(client: MCPClient, fn: () => Promise<T>): Promise<T> {
    this.mcpClientLeases.set(client, (this.mcpClientLeases.get(client) ?? 0) + 1);
    try {
      return await fn();
    } finally {
      const remaining = (this.mcpClientLeases.get(client) ?? 1) - 1;
      if (remaining > 0) this.mcpClientLeases.set(client, remaining);
      else {
        this.mcpClientLeases.delete(client);
        // The idle clock must reflect when the LAST lease ended, not when
        // the call started: an invocation longer than the TTL would
        // otherwise release an already-expired timestamp and an unrelated
        // same-key sweep would disconnect this just-used session.
        for (const [key, pooled] of this.mcpClientPool) {
          if (pooled === client) this.mcpClientLastUsedAt.set(key, Date.now());
        }
        if (this.mcpClientPendingDisconnect.delete(client)) {
          try {
            await client.disconnect();
          } catch (error) {
            logger.warn('Failed to disconnect evicted MCP client:', error);
          }
        }
      }
    }
  }

  /**
   * Drop a pooled session after a failed call so the next attempt starts
   * fresh. Never throws — the original call error matters more than cleanup.
   *
   * Requires the exact client the failed call ran on: without that identity
   * we must not disconnect anything, or a concurrent same-key recreate (call
   * B installing its replacement while call A's initialization fails) would
   * get its live session killed while the pool keeps pointing at it — a
   * permanently dead pooled entry until restart.
   */
  private async evictClient(params: MCPClientParams, client?: MCPClient): Promise<void> {
    if (!client) return;
    const key = this.mcpClientKeys.get(client) ?? serializeMcpClientParams(params);
    const pooled = this.mcpClientPool.get(key);
    // Only evict when the failing call ran on the pooled instance —
    // a concurrent recreate may have already replaced it.
    if (pooled && pooled === client) {
      this.mcpClientPool.delete(key);
      this.mcpClientLastUsedAt.delete(key);
    }
    // Defer the disconnect while the client still has in-flight calls:
    // manifest discovery and tool execution share one pooled session, so an
    // eviction triggered by one of them must not abort the other mid-call.
    // The last lease release performs the deferred disconnect.
    if (this.mcpClientLeases.has(client)) {
      this.mcpClientPendingDisconnect.add(client);
      return;
    }
    try {
      await client.disconnect();
    } catch (error) {
      logger.warn('Failed to disconnect evicted MCP client:', error);
    }
  }

  private async createClient(params: MCPClientParams, options: McpSessionOptions = {}) {
    const { MCPClient } = await loadMcpClient();
    const client = new MCPClient(params, options);
    await client.initialize();
    return client;
  }

  private async uploadMcpMediaBlock(base64: string, mediaType: MediaContentType, mimeType: string) {
    const config = MEDIA_UPLOAD_CONFIG[mediaType];
    const ext = getFileExtensionFromMimeType(mimeType, mediaType);
    const buffer = Buffer.from(base64, 'base64');
    const hash = createHash('sha256').update(buffer).digest('hex');
    const id = randomUUID();
    const filename = `${id}.${ext}`;
    const filePath = path.posix.join('mcp', config.pathnameSegment, todayShard(), filename);

    const { metadata } = await this.fileService.uploadFile({
      content: base64,
      filename,
      hash,
      path: filePath,
      type: mimeType,
    });

    return metadata.path;
  }

  private async processContentBlocks(blocks: ToolCallContent[]): Promise<ToolCallContent[]> {
    return Promise.all(
      blocks.map(async (block) => {
        if (block.type === 'image' || block.type === 'audio') {
          const mediaType = block.type;
          const mimeType = normalizeMimeType(block.mimeType, mediaType);
          const data = await this.uploadMcpMediaBlock(block.data, mediaType, mimeType);

          return { ...block, data, mimeType };
        }

        if (block.type === 'resource') {
          const resourceBlock = block as ResourceContent;
          const resource = resourceBlock.resource;
          const mediaType = getMediaContentType(resource?.mimeType);

          if (!resource?.blob || !mediaType) return block;

          const mimeType = normalizeMimeType(resource.mimeType, mediaType);
          const data = await this.uploadMcpMediaBlock(resource.blob, mediaType, mimeType);
          const metadata = resourceBlock._meta ? { _meta: resourceBlock._meta } : {};

          if (mediaType === 'image') {
            return { ...metadata, data, mimeType, type: 'image' } as ImageContent;
          }

          return { ...metadata, data, mimeType, type: 'audio' } as AudioContent;
        }

        return block;
      }),
    );
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

    let client: MCPClient | undefined;
    try {
      client = await this.acquireClient(params, { mcpApps: input.mcpApps });
      // Lease for the manifest refresh too: a concurrent stale-session
      // eviction must not disconnect underneath this pending request.
      const manifest = await this.withClientLease(client, () => client!.listManifests());
      const identifier = input.name;

      const api = toModelApi(manifest.tools || []);

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
        ...toMcpAppsManifestFields(manifest.tools || []),
        mcpParams: params,
        type: 'mcp' as any,
      });
    } catch (error) {
      // The pooled session this manifest refresh ran on is stale/broken —
      // evict it so the next refresh starts fresh instead of reacquiring
      // the same dead session forever. Identity-guarded: a concurrent
      // recreate must not be disconnected.
      await this.evictClient(params, client);
      // If it's an MCPConnectionError with stderr logs, enhance the error message
      const { MCPConnectionError } = await loadMcpClient();
      if (error instanceof MCPConnectionError && error.stderrLogs.length > 0) {
        const stderrOutput = error.stderrLogs.join('\n');
        const enhancedError = new Error(
          `${error.message}\n\n--- STDIO Process Output ---\n${stderrOutput}`,
        );
        enhancedError.name = error.name;
        logger.error('getStdioMcpServerManifest failed with STDIO logs:', {
          message: error.message,
          stderrLogs: error.stderrLogs,
        });
        throw enhancedError;
      }
      throw error;
    } finally {
      // Manifest listing shares the pooled session; nothing to clean up here.
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

    const client = await this.createClient(params, { mcpApps: input.mcpApps });
    try {
      const tools = await client.listTools();
      const api = toModelApi(tools);
      const identifier = input.identifier;

      return serializePayload({
        api,
        identifier,
        ...toMcpAppsManifestFields(tools),
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
      }));

    if (input.http) {
      const client = await this.createClient(
        { ...input.http, type: 'http' },
        { mcpApps: input.mcpApps },
      );
      try {
        return serializePayload(toListed(await client.listTools()));
      } finally {
        await client.disconnect();
      }
    }

    const params: MCPClientParams = {
      args: input.stdio.args || [],
      command: input.stdio.command,
      env: input.stdio.env,
      name: input.stdio.name,
      type: 'stdio',
    };
    let client: MCPClient | undefined;
    try {
      client = await this.acquireClient(params, { mcpApps: input.mcpApps });
      const tools = await this.withClientLease(client, () => client!.listTools());
      return serializePayload(toListed(tools));
    } catch (error) {
      // Same as the manifest refresh: drop a broken pooled session.
      await this.evictClient(params, client);
      throw error;
    }
  }

  @IpcMethod()
  async callTool(payload: SuperJSONSerialized<CallToolInput>) {
    const input = deserializePayload<CallToolInput>(payload);
    if ('http' in input && input.http) {
      return serializePayload(
        await this.runHttpMcpTool(input.http, input.toolName, input.args, {
          fromApp: input.fromApp,
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

    const read = (client: MCPClient) =>
      this.withClientLease(client, async () => {
        const result = await client.readResource(input.uri);
        // A view's _meta.ui may be declared once, on its resources/list entry
        if (!lacksUiResourceMeta(result)) return result;

        const listed = await client.listResources().catch((error) => {
          logger.warn('Failed to list resources for MCP App metadata:', { error });
          return [];
        });
        return withListingUiMeta(result, input.uri, listed);
      });
    // Reading is idempotent, so unlike tool calls a dead transport is retried
    // too: the stale session is evicted and the read runs once on a fresh one.
    const isSessionFailure = (error: unknown) =>
      isStaleSessionError(error) || isDeadTransportError(error);

    // Views are read only while MCP Apps are on, on a session that announces them
    const client = await this.acquireClient(params, { mcpApps: true });
    try {
      return serializePayload(await read(client));
    } catch (error) {
      if (!isSessionFailure(error)) throw error;

      logger.warn('MCP App resource read failed on pooled session, retrying with a fresh one:', {
        message: (error as Error).message,
      });
      await this.evictClient(params, client);
      const retryClient = await this.acquireClient(params, { mcpApps: true });
      try {
        return serializePayload(await read(retryClient));
      } catch (retryError) {
        if (isSessionFailure(retryError)) await this.evictClient(params, retryClient);
        throw retryError;
      }
    }
  }

  /** Fails closed: a view's call is refused while the tool's visibility can't be learned. */
  private async isToolCallableByApp(client: MCPClient, toolName: string) {
    try {
      return await client.isToolCallableByApp(toolName);
    } catch (error) {
      // A broken session is the call's own failure: let runMcpTool evict and
      // recover it, or every later view call would reuse the dead session
      if (isStaleSessionError(error, client.getProtocolEra()) || isDeadTransportError(error)) {
        throw error;
      }
      logger.warn('Failed to resolve MCP App visibility for tool:', { error, toolName });
      return false;
    }
  }

  /**
   * Fails open: while the tool's visibility can't be learned, the model's call
   * runs as it did before MCP Apps.
   */
  private async isToolHiddenFromModel(client: MCPClient, toolName: string) {
    try {
      return await client.isToolHiddenFromModel(toolName);
    } catch (error) {
      // A broken session is the call's own failure, recovered by runMcpTool
      if (isStaleSessionError(error, client.getProtocolEra()) || isDeadTransportError(error)) {
        throw error;
      }
      logger.warn('Failed to resolve MCP App visibility for tool:', { error, toolName });
      return false;
    }
  }

  /** Never fails the tool call: an unknown UI resource only means no interactive view. */
  private async getToolUiResourceUri(client: MCPClient, toolName: string) {
    try {
      return await client.getToolUiResourceUri(toolName);
    } catch (error) {
      logger.warn('Failed to resolve MCP App resource for tool:', { error, toolName });
      return undefined;
    }
  }

  /**
   * Core stdio MCP tool execution, shared by the renderer IPC path
   * ({@link callTool}) and the device-gateway tunnel (GatewayConnectionCtr,
   * which runs MCP calls forwarded from the cloud server). Returns the plain
   * result envelope; callers serialize as needed. Throws on failure so each
   * caller can shape its own error response.
   */
  async runStdioMcpTool(
    input: StdioCallToolInput,
  ): Promise<{ content: string; state: unknown; success: boolean }> {
    return this.runMcpTool(
      {
        args: input.params.args || [],
        command: input.params.command,
        env: input.env,
        name: input.params.name,
        type: 'stdio',
      },
      input.toolName,
      input.args,
      { fromApp: input.fromApp, mcpApps: input.mcpApps },
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
  ): Promise<{ content: string; state: unknown; success: boolean }> {
    return this.runMcpTool(
      {
        auth: input.auth,
        headers: input.headers,
        name: input.name,
        type: 'http',
        url: input.url,
      },
      toolName,
      rawArgs,
      options,
    );
  }

  private async runMcpTool(
    params: MCPClientParams,
    toolName: string,
    rawArgs: unknown,
    { fromApp = false, mcpApps = false }: McpCallOptions = {},
  ): Promise<{ content: string; state: unknown; success: boolean }> {
    try {
      const args = safeParseToRecord(rawArgs);

      // Reuse the pooled session (stateful stdio servers keep per-process
      // state such as a selected database). Retry once on a fresh session —
      // but only for confirmed stale-session / transport failures that
      // happen before a tool result was produced. App-level failures (tool
      // rejected the args, media post-processing failed, …) are surfaced
      // as-is: re-running a mutating tool on a generic catch could apply
      // its side effect a second time. The failing client is tagged onto
      // the error so eviction carries an identity guard.
      const runOn = (client: MCPClient) =>
        this.withClientLease(client, async () => {
          try {
            // A view may only call tools whose visibility includes the app,
            // and only while MCP Apps are on
            if (fromApp && !(mcpApps && (await this.isToolCallableByApp(client, toolName)))) {
              const message = `The tool "${toolName}" can't be called from an interactive view.`;
              return {
                content: message,
                error: { message, name: 'MCPToolError' },
                state: { content: [{ text: message, type: 'text' }], isError: true },
                success: false,
              };
            }
            // A tool the server keeps from the model is its views' alone, even
            // when the model names it (e.g. from an earlier turn)
            if (!fromApp && mcpApps && (await this.isToolHiddenFromModel(client, toolName))) {
              const message = `The tool "${toolName}" can only be called from its interactive view.`;
              return {
                content: message,
                error: { message, name: 'MCPToolError' },
                state: { content: [{ text: message, type: 'text' }], isError: true },
                success: false,
              };
            }
            const uiResourceUri = mcpApps
              ? await this.getToolUiResourceUri(client, toolName)
              : undefined;
            const raw = (await client.callTool(toolName, args)) as ToolCallResult;
            // A view gets the tool's own MCP result: its media stays base64
            // `data`, not the uploaded keys the chat stores and renders
            const processed =
              raw.isError || fromApp ? raw.content : await this.processContentBlocks(raw.content);
            const content = fromApp
              ? processed.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
              : await toMarkdown(processed, (key) => this.fileService.getFileHTTPURL(key));
            const state = {
              ...raw,
              content: processed,
              // MCP Apps: the `ui://` resource the chat renders this result with,
              // and the server it may be read back from
              ...(uiResourceUri &&
                !raw.isError && {
                  mcpApp: {
                    resourceUri: uiResourceUri,
                    server: await getMcpServerFingerprint(params),
                  },
                }),
            };
            return {
              content,
              ...(raw.isError ? { error: { message: content, name: 'MCPToolError' } } : {}),
              state,
              success: raw.isError !== true,
            };
          } catch (error) {
            throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
              ranOnClient: client,
            });
          }
        });

      try {
        return await runOn(await this.acquireClient(params, { mcpApps }));
      } catch (firstError) {
        const failedClient = (firstError as { ranOnClient?: MCPClient })?.ranOnClient;
        if (!isStaleSessionError(firstError, failedClient?.getProtocolEra())) {
          // A dead stdio subprocess must still be evicted even though the
          // failed call is NOT replayed: the request may have reached the
          // server before the pipe died, so re-running a mutating tool
          // could apply its side effect twice. Without eviction the dead
          // client stays pooled and every later same-key acquisition
          // refreshes and returns the same unusable session until restart.
          if (isDeadTransportError(firstError)) {
            logger.warn('MCP tool call failed on a dead transport, evicting pooled session:', {
              message: (firstError as Error).message,
              toolName,
            });
            await this.evictClient(params, failedClient);
          } else {
            logger.warn('MCP tool call failed (no retry for app-level error):', {
              message: (firstError as Error).message,
              toolName,
            });
          }
          throw firstError;
        }
        logger.warn('MCP tool call failed on pooled session, retrying with a fresh one:', {
          message: (firstError as Error).message,
          toolName,
        });
        await this.evictClient(params, failedClient);
        // Route replacement creation through acquireClient: it single-flights
        // per key, so two concurrent calls that shared the same stale client
        // and both failed build ONE replacement process — not two racing
        // create/set writes that strand the loser (and its established state).
        const retryClient = await this.acquireClient(params, { mcpApps });
        try {
          return await runOn(retryClient);
        } catch (retryError) {
          // Evict the replacement on a transport-level failure — stale
          // errors authorize a further retry, dead transports prove the
          // replacement dead: neither is handed to the next call. A
          // post-processing failure after a SUCCESSFUL tool call is not a
          // session problem — the tool already ran, so the healthy
          // replacement stays pooled.
          if (
            isStaleSessionError(retryError, retryClient.getProtocolEra()) ||
            isDeadTransportError(retryError)
          ) {
            await this.evictClient(params, retryClient);
          }
          throw retryError;
        }
      }
    } catch (error) {
      // If it's an MCPConnectionError with stderr logs, enhance the error message
      const { MCPConnectionError } = await loadMcpClient();
      if (error instanceof MCPConnectionError && error.stderrLogs.length > 0) {
        const stderrOutput = error.stderrLogs.join('\n');
        const enhancedError = new Error(
          `${error.message}\n\n--- STDIO Process Output ---\n${stderrOutput}`,
        );
        enhancedError.name = error.name;
        logger.error('callTool failed with STDIO logs:', {
          message: error.message,
          stderrLogs: error.stderrLogs,
        });
        throw enhancedError;
      }
      logger.error('callTool failed:', error);
      throw error;
    }
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
