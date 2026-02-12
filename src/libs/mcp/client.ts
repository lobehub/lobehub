import { spawn } from 'node:child_process';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { type Progress } from '@modelcontextprotocol/sdk/types.js';
import debug from 'debug';

import {
  type MCPClientParams,
  type MCPError,
  type McpPrompt,
  type McpResource,
  type McpTool,
  type ToolCallResult,
} from './types';
import { createMCPError } from './types';

const log = debug('lobe-mcp:client');
// MCP tool call timeout (milliseconds), configurable via the environment variable MCP_TOOL_TIMEOUT, default is 60000
// Parse MCP_TOOL_TIMEOUT, only use if it's a valid positive number, otherwise fallback to default 60000
const MCP_TOOL_TIMEOUT = (() => {
  const val = Number(process.env.MCP_TOOL_TIMEOUT);
  return Number.isFinite(val) && val > 0 ? val : 60_000;
})();

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
    log('Pre-checking stdio command: %s with args: %O', params.command, params.args);

    const child = spawn(params.command, params.args, {
      env: {
        ...process.env,
        ...getDefaultEnvironment(),
        ...params.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
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

    // Collect stdout
    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    // Collect stderr - this is the critical part
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
      log('Captured stderr: %s', data.toString());
    });

    child.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        log('Process spawn error: %O', error);
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
          log('Pre-check successful, stdout: %s', stdout);
          resolve({ success: true });
        } else {
          log('Pre-check failed with code: %d, stderr: %s', code, stderr);
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
      log('Failed to write to stdin: %O', writeError);
    }
  });
}

export class MCPClient {
  private mcp: Client;
  private transport: Transport;
  private params: MCPClientParams;

  constructor(params: MCPClientParams) {
    this.params = params;
    this.mcp = new Client({ name: 'lobehub-mcp-client', version: '1.0.0' });

    switch (params.type) {
      case 'http': {
        log('Using HTTP transport with url: %s', params.url);

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

        log('HTTP transport created with headers: %O', Object.keys(headers));

        break;
      }

      case 'stdio': {
        log('Using Stdio transport with command: %s , args: %O', params.command, params.args);

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
        log('Error creating client: %O', err);
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
      log('MCP connection failed:', e);

      if (this.params.type === 'http') {
        const error = e as Error;
        if (error.message.includes('401'))
          throw createMCPError('AUTHORIZATION_ERROR', error.message);

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
          log('Detailed error captured: %O', preCheckResult.error);
          throw preCheckResult.error;
        }
      }

      // For other connection types or when pre-check doesn't provide more information
      if ((e as any).code === -32_000) {
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
    log('Disconnecting MCP connection...');
    // Assuming the mcp client has a disconnect method
    if (this.mcp && typeof (this.mcp as any).disconnect === 'function') {
      await (this.mcp as any).disconnect();
      log('MCP connection disconnected.');
    } else {
      log('MCP client does not have a disconnect method or is not initialized.');
      // Depending on the transport, we might need specific cleanup
      if (this.transport && typeof (this.transport as any).close === 'function') {
        (this.transport as any).close();
        log('Transport closed.');
      }
    }
  }

  async listTools() {
    try {
      log('Listing tools...');
      const { tools } = await this.mcp.listTools();
      log('Listed tools: %O', tools);
      return tools as McpTool[];
    } catch (e) {
      console.error('Listed tools error: %O', e);

      if ((e as Error).message.includes('No valid session ID provided')) {
        throw new Error('NoValidSessionId');
      }

      return [];
    }
  }

  async listResources() {
    try {
      log('Listing resources...');
      const { resources } = await this.mcp.listResources();
      log('Listed resources: %O', resources);
      return resources as McpResource[];
    } catch (e) {
      log('Listed resources: %O', e);
      return [];
    }
  }

  async listPrompts() {
    try {
      log('Listing prompts...');
      const { prompts } = await this.mcp.listPrompts();
      log('Listed prompts: %O', prompts);
      return prompts as McpPrompt[];
    } catch (e) {
      log('Listed prompts: %O', e);
      return [];
    }
  }

  async listManifests() {
    const capabilities = this.mcp.getServerCapabilities();
    log('get capabilities: %O', capabilities);

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

    log('Listed Manifest: %O', manifest);

    return manifest;
  }

  async callTool(toolName: string, args: any): Promise<ToolCallResult> {
    log('Calling tool: %s with args: %O, timeout: %O', toolName, args, MCP_TOOL_TIMEOUT);
    const result = await this.mcp.callTool({ arguments: args, name: toolName }, undefined, {
      timeout: MCP_TOOL_TIMEOUT,
    });
    log('Tool call result: %O', result);
    return result as ToolCallResult;
  }
}
