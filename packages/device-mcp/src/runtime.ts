import {
  getMcpServerFingerprint,
  isMcpThreadEntrypoint,
  lacksUiResourceMeta,
  withListingUiMeta,
} from '@lobechat/const/mcpApp';

import type { MCPClient } from './client';
import {
  contentBlocksToMarkdown,
  type McpMediaUploader,
  type McpMediaUrlResolver,
  uploadMediaBlocks,
} from './content';
import {
  isDeadTransportError,
  isStaleSessionError,
  serializeMcpClientParams,
} from './sessionGuards';
import type { MCPClientParams, ToolCallContent, ToolCallResult } from './types';

const loadMcpClient = () => import('./client');

export interface DeviceMcpLogger {
  error: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
}

export interface DeviceMcpRuntimeOptions {
  /** `clientInfo.name` every session announces. */
  clientName?: string;
  /** Resolves an uploaded media key to the URL the model's markdown links to. */
  getMediaUrl: McpMediaUrlResolver;
  logger?: DeviceMcpLogger;
  /** Idle sessions older than this are disconnected at the next sweep. */
  poolIdleTtlMs?: number;
  /** Default `tools/call` deadline; a call's own `timeoutMs` wins. */
  toolTimeoutMs?: number;
  /** Stores a tool result's image / audio bytes and answers their key. */
  uploadMedia: McpMediaUploader;
}

/** Whether MCP Apps are announced on the session a call runs on. */
export interface McpSessionOptions {
  /** Announce MCP Apps on the session: the user has the `mcp_apps` flag. */
  mcpApps?: boolean;
}

/** How a tool call runs: whether a view made it, and whether MCP Apps are on. */
export interface McpCallOptions extends McpSessionOptions {
  /** An MCP App view's `tools/call`: only tools visible to the app run. */
  fromApp?: boolean;
  fromEntrypoint?: boolean;
  /** This call's deadline, e.g. the one a tunneled call carries. */
  timeoutMs?: number;
}

export interface McpToolOutput {
  content: string;
  error?: { message: string; name: string };
  state: unknown;
  success: boolean;
}

const DEFAULT_POOL_IDLE_TTL_MS = 30 * 60 * 1000;

const noopLogger: DeviceMcpLogger = { error: () => {}, warn: () => {} };

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

/**
 * An `MCPConnectionError` carries the stdio server's stderr tail; fold it into
 * the message so the caller (and the model) sees why the process failed.
 * Other errors pass through unchanged.
 */
export const withStdioOutput = async (error: unknown): Promise<unknown> => {
  const { MCPConnectionError } = await loadMcpClient();
  if (error instanceof MCPConnectionError && error.stderrLogs.length > 0) {
    const enhanced = new Error(
      `${error.message}\n\n--- STDIO Process Output ---\n${error.stderrLogs.join('\n')}`,
    );
    enhanced.name = error.name;
    return enhanced;
  }
  return error;
};

/**
 * Runs MCP servers only the user's machine can reach — stdio binaries and
 * localhost / LAN HTTP endpoints — for every device host (the desktop app's
 * main process and `lh connect`), so both execute a tunneled call the same way.
 *
 * Sessions are pooled per connection params. Stateful stdio servers (e.g. IDA's
 * `ida-mcp`: `open_database` sets a current database that later
 * `execute_python` calls depend on) lose their in-process state when the
 * session is torn down between calls, so one session is reused per unique
 * params and rebuilt only when a call fails on it.
 */
export class DeviceMcpRuntime {
  private readonly options: DeviceMcpRuntimeOptions;
  private readonly logger: DeviceMcpLogger;
  private readonly poolIdleTtlMs: number;

  private pool = new Map<string, MCPClient>();
  /** The pool key each client was created under, so eviction finds its own entry. */
  private clientKeys = new WeakMap<MCPClient, string>();
  private initialization = new Map<string, Promise<MCPClient>>();
  private lastUsedAt = new Map<string, number>();
  // In-flight call tracking: eviction and idle reaping are deferred while a
  // client holds any lease; release performs a pending eviction disconnect.
  private leases = new Map<MCPClient, number>();
  private pendingDisconnect = new Set<MCPClient>();

  constructor(options: DeviceMcpRuntimeOptions) {
    this.options = options;
    this.logger = options.logger ?? noopLogger;
    /**
     * Rationale for the idle TTL: stdio subprocesses are cheap to respawn but
     * leak when kept forever — a changed token/env/command produces a NEW
     * cache key while the old entry stays connected for the life of the host
     * process. It is deliberately long (30 min ≫ any realistic think-turn
     * between tool calls) so actively used stateful sessions are never reaped
     * mid-workflow: every acquire refreshes the clock.
     */
    this.poolIdleTtlMs = options.poolIdleTtlMs ?? DEFAULT_POOL_IDLE_TTL_MS;
  }

  /** A fresh, unpooled session. The caller owns it and must disconnect it. */
  async createClient(params: MCPClientParams, { mcpApps = false }: McpSessionOptions = {}) {
    const { MCPClient } = await loadMcpClient();
    const client = new MCPClient(params, {
      clientName: this.options.clientName,
      mcpApps,
      toolTimeoutMs: this.options.toolTimeoutMs,
    });
    await client.initialize();
    return client;
  }

  /**
   * Disconnect every pooled session so no MCP subprocess outlives the host.
   * Every disconnect is initiated synchronously before the first await, so a
   * host that cannot await its shutdown listener (Electron's `will-quit`)
   * still reaches every child. Never throws.
   */
  async dispose(): Promise<void> {
    const entries = [...this.pool.entries()];
    this.pool.clear();
    this.lastUsedAt.clear();
    const teardowns = entries.map(([, client]) =>
      client.disconnect().catch((error: unknown) => {
        this.logger.warn('Failed to disconnect MCP client on dispose:', error);
      }),
    );
    await Promise.all(teardowns);
  }

  /**
   * Disconnect and drop every pooled session that has been idle for longer
   * than the TTL. Never throws.
   */
  private async reapIdleClients(): Promise<void> {
    const now = Date.now();
    for (const [key, client] of this.pool) {
      const lastUsed = this.lastUsedAt.get(key) ?? 0;
      if (now - lastUsed < this.poolIdleTtlMs) continue;
      // A session with active in-flight calls is still working: disconnecting
      // it mid-call would kill a valid long-running tool invocation (the
      // idle clock only refreshes at acquisition, not during the call).
      if (this.leases.has(client)) continue;
      this.pool.delete(key);
      this.lastUsedAt.delete(key);
      try {
        await client.disconnect();
      } catch (error) {
        this.logger.warn('Failed to reap idle MCP client:', error);
      }
    }
  }

  /**
   * Return a pooled client for the given params, creating (and caching) a new
   * one when the pool has no healthy entry. Callers must NOT disconnect the
   * returned client — pooled sessions outlive a single tool call.
   */
  async acquireClient(
    params: MCPClientParams,
    { mcpApps = false }: McpSessionOptions = {},
  ): Promise<MCPClient> {
    // Sessions that announce MCP Apps and ones that don't are pooled apart
    const key = `${serializeMcpClientParams(params)}${mcpApps ? '#mcp-apps' : ''}`;

    // Every acquire refreshes the session's idle clock (fire-and-forget —
    // reaping must never delay or fail the tool call it runs alongside).
    this.lastUsedAt.set(key, Date.now());
    void this.reapIdleClients().catch(() => {});

    const cached = this.pool.get(key);
    if (cached) return cached;

    // Single-flight per key: concurrent manifest discovery + tool call on the
    // same uncached params must share one initialization, not spawn two
    // processes where the later map write silently replaces the first
    // (stranding whatever state the losing client had established).
    const inFlight = this.initialization.get(key);
    if (inFlight) return inFlight;

    const creating = this.createClient(params, { mcpApps })
      .then((client) => {
        this.clientKeys.set(client, key);
        this.pool.set(key, client);
        this.lastUsedAt.set(key, Date.now());
        return client;
      })
      .catch((error) => {
        // The acquire-time clock is an orphan when creation fails: failed
        // configs (serialized keys contain env values) must not accumulate.
        this.lastUsedAt.delete(key);
        throw error;
      })
      .finally(() => {
        this.initialization.delete(key);
      });
    this.initialization.set(key, creating);
    return creating;
  }

  /**
   * Run `fn` while holding a lease: eviction and idle reaping are deferred
   * while any lease is active. The last release refreshes the idle clock
   * (a call may outlast the TTL — the session is fresh the moment its work
   * ends, not when it started) and then performs any pending disconnect.
   */
  async withClientLease<T>(client: MCPClient, fn: () => Promise<T>): Promise<T> {
    this.leases.set(client, (this.leases.get(client) ?? 0) + 1);
    try {
      return await fn();
    } finally {
      const remaining = (this.leases.get(client) ?? 1) - 1;
      if (remaining > 0) this.leases.set(client, remaining);
      else {
        this.leases.delete(client);
        for (const [key, pooled] of this.pool) {
          if (pooled === client) this.lastUsedAt.set(key, Date.now());
        }
        if (this.pendingDisconnect.delete(client)) {
          try {
            await client.disconnect();
          } catch (error) {
            this.logger.warn('Failed to disconnect evicted MCP client:', error);
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
  async evictClient(params: MCPClientParams, client?: MCPClient): Promise<void> {
    if (!client) return;
    const key = this.clientKeys.get(client) ?? serializeMcpClientParams(params);
    const pooled = this.pool.get(key);
    // Only evict when the failing call ran on the pooled instance —
    // a concurrent recreate may have already replaced it.
    if (pooled && pooled === client) {
      this.pool.delete(key);
      this.lastUsedAt.delete(key);
    }
    // Defer the disconnect while the client still has in-flight calls:
    // manifest discovery and tool execution share one pooled session, so an
    // eviction triggered by one of them must not abort the other mid-call.
    // The last lease release performs the deferred disconnect.
    if (this.leases.has(client)) {
      this.pendingDisconnect.add(client);
      return;
    }
    try {
      await client.disconnect();
    } catch (error) {
      this.logger.warn('Failed to disconnect evicted MCP client:', error);
    }
  }

  /**
   * Every tool the server lists, on the pooled session (stdio) or a one-shot
   * one (HTTP, which keeps no process state worth reusing).
   */
  async listTools(params: MCPClientParams, options: McpSessionOptions = {}) {
    if (params.type === 'http') {
      const client = await this.createClient(params, options);
      try {
        return await client.listTools();
      } finally {
        await client.disconnect();
      }
    }

    let client: MCPClient | undefined;
    try {
      client = await this.acquireClient(params, options);
      const pooled = client;
      return await this.withClientLease(pooled, () => pooled.listTools());
    } catch (error) {
      // Drop a broken pooled session so the next refresh starts fresh.
      await this.evictClient(params, client);
      throw await withStdioOutput(error);
    }
  }

  /**
   * Read an MCP Apps `ui://` resource, so the chat can render a tool result's
   * interactive view. Reading is idempotent, so unlike tool calls a dead
   * transport is retried too: the stale session is evicted and the read runs
   * once on a fresh one.
   */
  async readUiResource(params: MCPClientParams, uri: string) {
    if (!uri?.startsWith('ui://')) throw new Error('Only ui:// resources can be read');

    const read = (client: MCPClient) =>
      this.withClientLease(client, async () => {
        const result = await client.readResource(uri);
        // A view's _meta.ui may be declared once, on its resources/list entry
        if (!lacksUiResourceMeta(result, true)) return result;

        const listed = await client.listResources().catch((error) => {
          this.logger.warn('Failed to list resources for MCP App metadata:', { error });
          return [];
        });
        return withListingUiMeta(result, uri, listed, true);
      });
    const isSessionFailure = (error: unknown) =>
      isStaleSessionError(error) || isDeadTransportError(error);

    // Views are read only while MCP Apps are on, on a session that announces them
    const client = await this.acquireClient(params, { mcpApps: true });
    try {
      return await read(client);
    } catch (error) {
      if (!isSessionFailure(error)) throw error;

      this.logger.warn(
        'MCP App resource read failed on pooled session, retrying with a fresh one:',
        {
          message: (error as Error).message,
        },
      );
      await this.evictClient(params, client);
      const retryClient = await this.acquireClient(params, { mcpApps: true });
      try {
        return await read(retryClient);
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
      // A broken session is the call's own failure: let runTool evict and
      // recover it, or every later view call would reuse the dead session
      if (isStaleSessionError(error, client.getProtocolEra()) || isDeadTransportError(error)) {
        throw error;
      }
      this.logger.warn('Failed to resolve MCP App visibility for tool:', { error, toolName });
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
      // A broken session is the call's own failure, recovered by runTool
      if (isStaleSessionError(error, client.getProtocolEra()) || isDeadTransportError(error)) {
        throw error;
      }
      this.logger.warn('Failed to resolve MCP App visibility for tool:', { error, toolName });
      return false;
    }
  }

  /** Never fails the tool call: an unknown UI resource only means no interactive view. */
  private async getToolUiResourceUri(client: MCPClient, toolName: string) {
    try {
      return await client.getToolUiResourceUri(toolName);
    } catch (error) {
      this.logger.warn('Failed to resolve MCP App resource for tool:', { error, toolName });
      return undefined;
    }
  }

  private async callOnClient(
    client: MCPClient,
    params: MCPClientParams,
    toolName: string,
    args: Record<string, unknown>,
    { fromApp = false, fromEntrypoint = false, mcpApps = false, timeoutMs }: McpCallOptions,
  ): Promise<McpToolOutput> {
    if (
      fromEntrypoint &&
      !(mcpApps && isMcpThreadEntrypoint(await client.getToolUiMeta(toolName)))
    ) {
      const message = 'This tool does not declare an enabled thread entrypoint.';
      return {
        content: message,
        state: { content: [{ text: message, type: 'text' }], isError: true },
        success: false,
      };
    }
    // A view may only call tools whose visibility includes the app,
    // and only while MCP Apps are on
    if (
      !fromEntrypoint &&
      fromApp &&
      !(mcpApps && (await this.isToolCallableByApp(client, toolName)))
    ) {
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
    if (
      !fromEntrypoint &&
      !fromApp &&
      mcpApps &&
      (await this.isToolHiddenFromModel(client, toolName))
    ) {
      const message = `The tool "${toolName}" can only be called from its interactive view.`;
      return {
        content: message,
        error: { message, name: 'MCPToolError' },
        state: { content: [{ text: message, type: 'text' }], isError: true },
        success: false,
      };
    }
    const uiResourceUri = mcpApps ? await this.getToolUiResourceUri(client, toolName) : undefined;
    const preferredModelDisplayMode = uiResourceUri
      ? (await client.getToolUiMeta(toolName))?.preferredModelDisplayMode
      : undefined;
    const raw = (
      timeoutMs === undefined
        ? await client.callTool(toolName, args)
        : await client.callTool(toolName, args, { timeoutMs })
    ) as ToolCallResult;
    // A view gets the tool's own MCP result: its media stays base64
    // `data`, not the uploaded keys the chat stores and renders
    const processed: ToolCallContent[] =
      raw.isError || fromApp || fromEntrypoint
        ? raw.content
        : await uploadMediaBlocks(raw.content, this.options.uploadMedia);
    const content =
      fromApp || fromEntrypoint
        ? processed.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
        : await contentBlocksToMarkdown(processed, this.options.getMediaUrl);
    const state = {
      ...raw,
      content: processed,
      // MCP Apps: the `ui://` resource the chat renders this result with,
      // and the server it may be read back from
      ...(uiResourceUri &&
        !raw.isError && {
          mcpApp: {
            resourceUri: uiResourceUri,
            ...(preferredModelDisplayMode && { preferredModelDisplayMode }),
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
  }

  /**
   * Call one tool on the pooled session for `params`. Returns the result
   * envelope; throws on failure so each host can shape its own error.
   *
   * Retries once on a fresh session — but only for confirmed stale-session /
   * transport failures that happen before a tool result was produced.
   * App-level failures (tool rejected the args, media post-processing
   * failed, …) are surfaced as-is: re-running a mutating tool on a generic
   * catch could apply its side effect a second time.
   */
  async runTool(
    params: MCPClientParams,
    toolName: string,
    rawArgs: unknown,
    options: McpCallOptions = {},
  ): Promise<McpToolOutput> {
    const { mcpApps = false } = options;
    try {
      const args = options.fromEntrypoint ? {} : safeParseToRecord(rawArgs);

      // The failing client is tagged onto the error so eviction carries an
      // identity guard.
      const runOn = (client: MCPClient) =>
        this.withClientLease(client, async () => {
          try {
            return await this.callOnClient(client, params, toolName, args, options);
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
          // returns the same unusable session until restart.
          if (isDeadTransportError(firstError)) {
            this.logger.warn('MCP tool call failed on a dead transport, evicting pooled session:', {
              message: (firstError as Error).message,
              toolName,
            });
            await this.evictClient(params, failedClient);
          } else {
            this.logger.warn('MCP tool call failed (no retry for app-level error):', {
              message: (firstError as Error).message,
              toolName,
            });
          }
          throw firstError;
        }
        this.logger.warn('MCP tool call failed on pooled session, retrying with a fresh one:', {
          message: (firstError as Error).message,
          toolName,
        });
        await this.evictClient(params, failedClient);
        // Route replacement creation through acquireClient: it single-flights
        // per key, so two concurrent calls that shared the same stale client
        // and both failed build ONE replacement process.
        const retryClient = await this.acquireClient(params, { mcpApps });
        try {
          return await runOn(retryClient);
        } catch (retryError) {
          // Evict the replacement on a transport-level failure. A
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
      const enhanced = await withStdioOutput(error);
      this.logger.error('callTool failed:', enhanced);
      throw enhanced;
    }
  }
}
