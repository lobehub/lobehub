import { getMcpToolVisibility } from '@lobechat/const/mcpApp';

export interface LocalMcpTool {
  description?: string;
  inputSchema?: Record<string, unknown>;
  toolName: string;
  /** The tool's MCP Apps `_meta.ui.visibility`, when it declares one. */
  visibility?: string[];
}

export type LocalMcpParams =
  | { headers?: Record<string, string>; type: 'http'; url: string }
  | { args?: string[]; command: string; env?: Record<string, string>; type: 'stdio' };

const STDERR_TAIL_LINES = 10;

/**
 * Connect to an MCP server from the CLI host and list its tools. Used for
 * connectors the LobeHub server cannot reach itself (stdio binaries on this
 * machine, local/private-network HTTP endpoints) — the CLI counterpart of the
 * desktop app's local manifest fetch.
 */
export async function listLocalMcpTools(params: LocalMcpParams): Promise<LocalMcpTool[]> {
  // Lazy-load the SDK so other `lh` commands do not pay for it at startup.
  const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');

  const client = new Client(
    { name: 'lobehub-cli-mcp-client', version: '1.0.0' },
    {
      inputRequired: { autoFulfill: false },
      versionNegotiation: { mode: params.type === 'http' ? 'auto' : 'legacy' },
    },
  );

  const stderr: string[] = [];
  let transport;
  if (params.type === 'http') {
    transport = new StreamableHTTPClientTransport(new URL(params.url), {
      requestInit: { headers: params.headers },
    });
  } else {
    const { getDefaultEnvironment, StdioClientTransport } =
      await import('@modelcontextprotocol/client/stdio');
    const stdio = new StdioClientTransport({
      args: params.args,
      command: params.command,
      env: { ...getDefaultEnvironment(), ...params.env },
      stderr: 'pipe',
    });
    stdio.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(...chunk.toString('utf8').split('\n').filter(Boolean));
      if (stderr.length > STDERR_TAIL_LINES) stderr.splice(0, stderr.length - STDERR_TAIL_LINES);
    });
    transport = stdio;
  }

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return tools.map((tool) => ({
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
      toolName: tool.name,
      // `syncToolsFromClientById` stores a missing visibility as null, which
      // would make a view-only (`['app']`) tool model-visible.
      visibility: getMcpToolVisibility(tool._meta),
    }));
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    throw new Error(stderr.length > 0 ? `${message}\n${stderr.join('\n')}` : message, {
      cause: error,
    });
  } finally {
    await client.close().catch(() => {});
  }
}
