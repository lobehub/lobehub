import { spawn } from 'node:child_process';

import {
  McpElicitationClient,
  type McpElicitationContinuation,
  type McpElicitationHost,
  McpProtocolClient,
} from '@lobechat/mcp-elicitation';
import type { Client, Progress, Transport } from '@modelcontextprotocol/client';
import {
  InsufficientScopeError,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import debug from 'debug';

import { getMcpToolTimeoutMs } from './timeout';
import {
  type MCPClientParams,
  type MCPError,
  type McpPrompt,
  type McpResource,
  type McpTool,
  type ToolCallResult,
} from './types';
import { createMCPError } from './types';
import { getMCPErrorLogMetadata, getMCPLogOrigin } from './utils';

const log = debug('lobe-mcp:client');
// MCP tool call timeout (milliseconds), configurable via the environment variable MCP_TOOL_TIMEOUT, default is 60000
// Parse MCP_TOOL_TIMEOUT, only use if it's a valid positive number, otherwise fallback to default 60000
const MCP_TOOL_TIMEOUT = getMcpToolTimeoutMs();

/**
 * Pre-check stdio command to capture detailed error information
 */
async function preCheckStdioCommand(params: {
  args: string[];
  command: string;
  env?: Record<string, string>;
}): Promise<{
  error?: MCPError;
  success: boolean;
}> {
  return new Promise((resolve) => {
    log('Pre-checking stdio command');

    // Do NOT spread the full process.env here: it would leak server-side secrets
    // (DATABASE_URL, KEY_VAULTS_SECRET, provider API keys, OAuth/JWT secrets, ...)
    // into the spawned MCP subprocess. Match the main StdioClientTransport below,
    // which only exposes the safe default environment plus user-configured vars.
    // The cast is required because this repo augments NodeJS.ProcessEnv with
    // required app keys that a restricted env intentionally omits.
    const env = {
      ...getDefaultEnvironment(),
      ...params.env,
    } as NodeJS.ProcessEnv;

    const child = spawn(params.command, params.args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    let resolved = false;

    // Set timeout (5 seconds)
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill('SIGTERM');
        resolve({
          error: createMCPError('INITIALIZATION_TIMEOUT', 'MCP service initialization timeout', {
            errorLog: stderr || 'No stderr output',
            params: {
              args: params.args,
              command: params.command,
            },
            step: 'precheck_timeout',
          }),
          success: false,
        });
      }
    }, 5000);

    child.stdout?.resume();

    // Collect stderr - this is the critical part
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
      log('Captured stdio stderr output');
    });

    child.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        console.error('MCP pre-check process spawn failed:', getMCPErrorLogMetadata(error));
        resolve({
          error: createMCPError('PROCESS_SPAWN_ERROR', 'Failed to start MCP service process', {
            originalError: error.message,
            params: {
              args: params.args,
              command: params.command,
            },
            step: 'process_spawn',
          }),
          success: false,
        });
      }
    });

    child.on('exit', (code, signal) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);

        if (code === 0) {
          log('MCP pre-check completed successfully');
          resolve({ success: true });
        } else {
          console.error('MCP pre-check process exited:', {
            exitCode: code,
            signal,
          });
          resolve({
            error: createMCPError('CONNECTION_FAILED', 'MCP service startup failed', {
              errorLog: stderr,
              params: {
                args: params.args,
                command: params.command,
              },
              process: {
                exitCode: code || undefined,
                signal: signal || undefined,
              },
              step: 'process_exit',
            }),
            success: false,
          });
        }
      }
    });

    // Send a simple JSON-RPC initialization message to test the connection
    try {
      const initMessage =
        JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            clientInfo: { name: 'lobe-mcp-precheck', version: '1.0.0' },
            protocolVersion: '2024-11-05',
          },
        }) + '\n';

      child.stdin?.write(initMessage);
      child.stdin?.end();
    } catch (writeError) {
      console.error('Failed to write MCP pre-check request:', getMCPErrorLogMetadata(writeError));
    }
  });
}

export class MCPClient {
  private mcp: Client;
  private elicitation: McpElicitationClient;
  private transport: Transport;
  private params: MCPClientParams;

  constructor(params: MCPClientParams, elicitationEnabled = false) {
    this.params = params;
    this.mcp = new McpProtocolClient(
      { name: 'lobehub-mcp-client', version: '1.0.0' },
      {
        // Stdio stays legacy: auto would spawn a sibling probe process and can
        // wait the entire probe timeout on servers that ignore unknown requests.
        versionNegotiation: { mode: params.type === 'http' ? 'auto' : 'legacy' },
        // Elicitation is hosted explicitly; sampling and roots remain disabled.
        inputRequired: { autoFulfill: false },
      },
    );

    this.elicitation = new McpElicitationClient(this.mcp, elicitationEnabled);

    switch (params.type) {
      case 'http': {
        log('Using HTTP transport: %O', {
          origin: getMCPLogOrigin(params.url),
          type: params.type,
        });

        // Build headers, including custom headers and authentication information
        const headers: Record<string, string> = { ...params.headers };

        // Handle authentication configuration
        if (params.auth) {
          switch (params.auth.type) {
            case 'bearer': {
              if (params.auth.token) {
                headers['Authorization'] = `Bearer ${params.auth.token}`;
                log('Added Bearer token authentication');
              }
              break;
            }
            case 'oauth2': {
              if (params.auth.accessToken) {
                headers['Authorization'] = `Bearer ${params.auth.accessToken}`;
                log('Added OAuth2 access token authentication');
              }
              break;
            }

            default: {
              // No authentication required
              break;
            }
          }
        }

        // Create StreamableHTTPClientTransport and pass headers
        this.transport = new StreamableHTTPClientTransport(new URL(params.url), {
          requestInit: { headers },
        });

        log('HTTP transport created with %d header(s)', Object.keys(headers).length);

        break;
      }

      case 'stdio': {
        log('Using stdio transport');

        this.transport = new StdioClientTransport({
          args: params.args,
          command: params.command,
          env: {
            ...getDefaultEnvironment(),
            ...params.env,
          },
        });
        break;
      }

      default: {
        const err = createMCPError(
          'VALIDATION_ERROR',
          `Unsupported MCP connection type: ${(params as any).type}`,
          {
            params: { type: (params as any).type },
          },
        );
        console.error('Failed to create MCP client:', getMCPErrorLogMetadata(err));
        throw err;
      }
    }
  }

  async initialize(options: { onProgress?: (progress: Progress) => void } = {}) {
    log('Initializing MCP connection...');

    try {
      await this.mcp.connect(this.transport, { onprogress: options.onProgress });
      log('MCP connection initialized.');
    } catch (e) {
      console.error('MCP connection failed:', getMCPErrorLogMetadata(e));

      if (this.params.type === 'http') {
        if (
          (SdkHttpError.isInstance(e) && (e.status === 401 || e.status === 403)) ||
          UnauthorizedError.isInstance(e) ||
          InsufficientScopeError.isInstance(e)
        )
          throw createMCPError(
            'AUTHORIZATION_ERROR',
            'MCP server authorization failed. Reconnect this MCP in your connector settings and try again.',
            { originalError: e.message },
          );

        if (SdkError.isInstance(e) && e.code === SdkErrorCode.RequestTimeout)
          throw createMCPError(
            'INITIALIZATION_TIMEOUT',
            'MCP server version negotiation timed out. Check the server connection and try again.',
          );

        if (SdkError.isInstance(e) && e.code === SdkErrorCode.EraNegotiationFailed)
          throw createMCPError(
            'CONNECTION_FAILED',
            `Could not negotiate the MCP server protocol: ${e.message}`,
          );

        throw e;
      }

      // For stdio connection failure, attempt to pre-check command to get detailed error information
      if (this.params.type === 'stdio') {
        log('Attempting to pre-check stdio command for detailed error information...');

        const preCheckResult = await preCheckStdioCommand({
          args: this.params.args,
          command: this.params.command,
          env: this.params.env,
        });

        if (!preCheckResult.success && preCheckResult.error) {
          console.error(
            'MCP stdio pre-check failed:',
            getMCPErrorLogMetadata(preCheckResult.error),
          );
          throw preCheckResult.error;
        }
      }

      // For other connection types or when pre-check doesn't provide more information
      if (SdkError.isInstance(e) && e.code === SdkErrorCode.ConnectionClosed) {
        throw createMCPError(
          'CONNECTION_FAILED',
          'Failed to connect to MCP server, please check your configuration',
          {
            originalError: (e as Error).message,
            params: {
              args: this.params.args,
              command: this.params.command,
              type: this.params.type,
            },
            step: 'mcp_connect',
          },
        );
      }

      // Wrap other unknown errors
      throw createMCPError('UNKNOWN_ERROR', (e as Error).message, {
        originalError: (e as Error).message,
        params: {
          args: this.params.args,
          command: this.params.command,
          type: this.params.type,
        },
        step: 'mcp_connect',
      });
    }
  }

  async disconnect() {
    await this.elicitation.closeWhenIdle();
    log('MCP connection disconnected.');
  }

  getProtocolEra() {
    return this.mcp.getProtocolEra();
  }

  /**
   * Detect the StreamableHTTP "session expired" error.
   *
   * Happens when the remote MCP server restarts: the cached client still sends
   * the old session id and the server rejects it with HTTP 404. The legacy
   * example-server message is also recognized. Callers (e.g. MCPService) surface this as a dedicated
   * `NoValidSessionId` error and retry with a freshly-initialized session.
   */
  private isNoValidSessionError(e: unknown): boolean {
    return (
      this.getProtocolEra() !== 'modern' &&
      ((SdkHttpError.isInstance(e) && e.status === 404) ||
        (e instanceof Error && e.message.includes('No valid session ID provided')))
    );
  }

  async listTools() {
    try {
      log('Listing tools...');
      const { tools } = await this.mcp.listTools();
      log('Listed %d MCP tool(s)', tools.length);
      return tools as McpTool[];
    } catch (e) {
      console.error('Failed to list MCP tools:', getMCPErrorLogMetadata(e));

      if (this.isNoValidSessionError(e)) {
        throw new Error('NoValidSessionId', { cause: e });
      }

      if (ProtocolError.isInstance(e) && e.code === -32601) return [];
      throw e;
    }
  }

  async listResources() {
    try {
      log('Listing resources...');
      const { resources } = await this.mcp.listResources();
      log('Listed %d MCP resource(s)', resources.length);
      return resources as McpResource[];
    } catch (e) {
      console.error('Failed to list MCP resources:', getMCPErrorLogMetadata(e));

      if (this.isNoValidSessionError(e)) {
        throw new Error('NoValidSessionId', { cause: e });
      }

      if (ProtocolError.isInstance(e) && e.code === -32601) return [];
      throw e;
    }
  }

  async listPrompts() {
    try {
      log('Listing prompts...');
      const { prompts } = await this.mcp.listPrompts();
      log('Listed %d MCP prompt(s)', prompts.length);
      return prompts as McpPrompt[];
    } catch (e) {
      console.error('Failed to list MCP prompts:', getMCPErrorLogMetadata(e));

      if (this.isNoValidSessionError(e)) {
        throw new Error('NoValidSessionId', { cause: e });
      }

      if (ProtocolError.isInstance(e) && e.code === -32601) return [];
      throw e;
    }
  }

  async listManifests() {
    log('Reading MCP server capabilities');

    const [tools, prompts, resources] = await Promise.all([
      this.listTools(),
      this.listPrompts(),
      this.listResources(),
    ]);

    const manifest = {
      prompts: prompts.length === 0 ? undefined : prompts,
      resources: resources.length === 0 ? undefined : resources,
      title: this.mcp.getServerVersion()?.title,
      tools: tools.length === 0 ? undefined : tools,
      version: this.mcp.getServerVersion()?.version?.replace('v', ''),
    };

    log('Listed MCP manifest: %O', {
      promptCount: prompts.length,
      resourceCount: resources.length,
      toolCount: tools.length,
    });

    return manifest;
  }

  async callTool(
    toolName: string,
    args: any,
    options: {
      host?: McpElicitationHost;
      continuation?: McpElicitationContinuation;
      signal?: AbortSignal;
      interactive?: boolean;
      timeoutMs?: number;
    } = {},
  ): Promise<ToolCallResult> {
    log('Calling MCP tool: %O', { timeout: MCP_TOOL_TIMEOUT, toolName });
    try {
      const invoke =
        options.interactive && options.host
          ? () =>
              this.elicitation.callToolInteractively(
                { arguments: args, name: toolName },
                { timeout: options.timeoutMs ?? MCP_TOOL_TIMEOUT, signal: options.signal },
                options.host!,
              )
          : () =>
              this.elicitation.callTool(
                { arguments: args, name: toolName },
                {
                  timeout: options.timeoutMs ?? MCP_TOOL_TIMEOUT,
                  signal: options.signal,
                },
                options.host,
                options.continuation,
              );
      const result = await invoke();
      log('MCP tool call completed: %O', {
        contentBlockCount: Array.isArray(result.content) ? result.content.length : 0,
        isError: result.isError === true,
        toolName,
      });
      return result as ToolCallResult;
    } catch (e) {
      // The server rejects the request before executing the tool, so retrying
      // with a fresh session is safe (no double side effects).
      if (this.isNoValidSessionError(e)) {
        throw new Error('NoValidSessionId', { cause: e });
      }
      throw e;
    }
  }
}
