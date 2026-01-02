import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Progress } from '@modelcontextprotocol/sdk/types.js';

import { getDesktopEnv } from '@/env';

import type { MCPClientParams, McpPrompt, McpResource, McpTool, ToolCallResult } from './types';

export class MCPClient {
  private readonly mcp: Client;

  private transport: Transport;

  constructor(params: MCPClientParams) {
    this.mcp = new Client({ name: 'lobehub-desktop-mcp-client', version: '1.0.0' });

    switch (params.type) {
      case 'http': {
        const headers: Record<string, string> = { ...params.headers };

        if (params.auth) {
          if (params.auth.type === 'bearer' && params.auth.token) {
            headers['Authorization'] = `Bearer ${params.auth.token}`;
          }

          if (params.auth.type === 'oauth2' && params.auth.accessToken) {
            headers['Authorization'] = `Bearer ${params.auth.accessToken}`;
          }
        }

        this.transport = new StreamableHTTPClientTransport(new URL(params.url), {
          requestInit: { headers },
        });
        break;
      }

      case 'stdio': {
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
        // Exhaustive check
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _never: never = params;
        throw new Error(`Unsupported MCP connection type: ${(params as any).type}`);
      }
    }
  }

  private isMethodNotFoundError(error: unknown) {
    const err = error as any;
    if (!err) return false;
    if (err.code === -32601) return true;
    if (typeof err.message === 'string' && err.message.includes('Method not found')) return true;
    return false;
  }

  async initialize(options: { onProgress?: (progress: Progress) => void } = {}) {
    await this.mcp.connect(this.transport, { onprogress: options.onProgress });
  }

  async disconnect() {
    if (typeof (this.mcp as any).disconnect === 'function') {
      await (this.mcp as any).disconnect();
      return;
    }

    if (this.transport && typeof (this.transport as any).close === 'function') {
      (this.transport as any).close();
    }
  }

  async listTools() {
    const { tools } = await this.mcp.listTools();
    return (tools || []) as McpTool[];
  }

  async listResources() {
    const { resources } = await this.mcp.listResources();
    return (resources || []) as McpResource[];
  }

  async listPrompts() {
    const { prompts } = await this.mcp.listPrompts();
    return (prompts || []) as McpPrompt[];
  }

  async listManifests() {
    const [tools, prompts, resources] = await Promise.all([
      this.listTools(),
      this.listPrompts().catch((error) => {
        if (this.isMethodNotFoundError(error)) return [] as McpPrompt[];
        throw error;
      }),
      this.listResources().catch((error) => {
        if (this.isMethodNotFoundError(error)) return [] as McpResource[];
        throw error;
      }),
    ]);

    return {
      prompts: prompts.length === 0 ? undefined : prompts,
      resources: resources.length === 0 ? undefined : resources,
      title: this.mcp.getServerVersion()?.title,
      tools: tools.length === 0 ? undefined : tools,
      version: this.mcp.getServerVersion()?.version?.replace('v', ''),
    };
  }

  async callTool(toolName: string, args: any): Promise<ToolCallResult> {
    const result = await this.mcp.callTool({ arguments: args, name: toolName }, undefined, {
      timeout: getDesktopEnv().MCP_TOOL_TIMEOUT,
    });
    return result as ToolCallResult;
  }
}
