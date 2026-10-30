import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

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
 * expectations (e.g. `@/config/*`) into the desktop `tsgo` typecheck.
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

interface GetStdioMcpServerManifestInput {
  args?: string[];
  command: string;
  env?: Record<string, string>;
  metadata?: CustomPluginMetadata;
  name: string;
  type?: 'stdio';
}

interface GetStreamableMcpServerManifestInput {
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

interface HttpMcpCallInput {
  auth?: { accessToken?: string; token?: string; type: 'none' | 'bearer' | 'oauth2' };
  headers?: Record<string, string>;
  name: string;
  type: 'http';
  url: string;
}

export interface CallToolInput {
  args: any;
  env: any;
  params: (GetStdioMcpServerManifestInput & { type: 'stdio' }) | HttpMcpCallInput;
  toolName: string;
}

type SuperJSONSerialized<T = unknown> = McpIpcPayload<T>;

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
  private async acquireClient(params: MCPClientParams): Promise<MCPClient> {
    const key = serializeMcpClientParams(params);

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

    const creating = this.createClient(params)
      .then((client) => {
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
    const key = serializeMcpClientParams(params);
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

  private async createClient(params: MCPClientParams) {
    const { MCPClient } = await loadMcpClient();
    const client = new MCPClient(params);
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
      client = await this.acquireClient(params);
      // Lease for the manifest refresh too: a concurrent stale-session
      // eviction must not disconnect underneath this pending request.
      const manifest = await this.withClientLease(client, () => client!.listManifests());
      const identifier = input.name;

      const tools = manifest.tools || [];

      return serializePayload({
        api: tools.map((item) => ({
          description: item.description,
          name: item.name,
          parameters: item.inputSchema as any,
        })),
        identifier,
        meta: {
          avatar: input.metadata?.avatar || 'MCP_AVATAR',
          description: input.metadata?.description || getMcpServerDescription(identifier, manifest),
          title: input.metadata?.name || identifier,
        },
        ...manifest,
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

    const client = await this.createClient(params);
    try {
      const tools = await client.listTools();
      const identifier = input.identifier;

      return serializePayload({
        api: tools.map((item) => ({
          description: item.description,
          name: item.name,
          parameters: item.inputSchema as any,
        })),
        identifier,
        mcpParams: params,
        meta: {
          avatar: input.metadata?.avatar || 'MCP_AVATAR',
          description:
            input.metadata?.description ||
            getMcpServerDescription(identifier, { tools }, { includeToolExample: true }),
          title: identifier,
        },
        type: 'mcp' as any,
      });
    } finally {
      await client.disconnect();
    }
  }

  @IpcMethod()
  async callTool(payload: SuperJSONSerialized<CallToolInput>) {
    const input = deserializePayload<CallToolInput>(payload);
    if (input.params.type === 'http') {
      return serializePayload(await this.runHttpMcpTool(input.params, input.toolName, input.args));
    }
    return serializePayload(await this.runStdioMcpTool(input));
  }

  /**
   * Core stdio MCP tool execution, shared by the renderer IPC path
   * ({@link callTool}) and the device-gateway tunnel (GatewayConnectionCtr,
   * which runs MCP calls forwarded from the cloud server). Returns the plain
   * result envelope; callers serialize as needed. Throws on failure so each
   * caller can shape its own error response.
   */
  async runStdioMcpTool(
    input: CallToolInput,
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
    );
  }

  private async runMcpTool(
    params: MCPClientParams,
    toolName: string,
    rawArgs: unknown,
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
            const raw = (await client.callTool(toolName, args)) as ToolCallResult;
            const processed = raw.isError
              ? raw.content
              : await this.processContentBlocks(raw.content);
            const content = await toMarkdown(processed, (key) =>
              this.fileService.getFileHTTPURL(key),
            );
            return {
              content,
              ...(raw.isError ? { error: { message: content, name: 'MCPToolError' } } : {}),
              state: { ...raw, content: processed },
              success: raw.isError !== true,
            };
          } catch (error) {
            throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
              ranOnClient: client,
            });
          }
        });

      try {
        return await runOn(await this.acquireClient(params));
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
        const retryClient = await this.acquireClient(params);
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
