// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MCPService } from './index';

/**
 * A real Streamable HTTP MCP server on 127.0.0.1, the kind of address a
 * marketplace listing must not make the server reach. Stateless: every request
 * gets its own server and transport, answered as plain JSON.
 */
const startLoopbackMcpServer = async () => {
  const httpServer = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);

    const mcp = new McpServer({ name: 'loopback', version: '1.0.0' });
    mcp.registerTool(
      'echo',
      { description: 'Echo the text', inputSchema: z.object({ text: z.string() }) },
      async ({ text }) => ({ content: [{ text, type: 'text' }] }),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: undefined,
    });
    await mcp.connect(transport);

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && chunks.length > 0;
    const response = await transport.handleRequest(
      new Request(`http://127.0.0.1${req.url}`, {
        body: hasBody ? Buffer.concat(chunks) : undefined,
        headers: req.headers as Record<string, string>,
        method: req.method,
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;
  return { close: () => httpServer.close(), url: `http://127.0.0.1:${port}/mcp` };
};

let server: Awaited<ReturnType<typeof startLoopbackMcpServer>>;
const allowPrivate = process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS;

beforeAll(async () => {
  server = await startLoopbackMcpServer();
});

afterAll(() => server.close());

afterEach(() => {
  if (allowPrivate === undefined) delete process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS;
  else process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS = allowPrivate;
});

const params = () => ({ name: 'loopback-mcp', type: 'http' as const, url: server.url });
const guarded = () => ({ ...params(), ssrfSafe: true });
const echo = (clientParams: ReturnType<typeof params>) => ({
  argsStr: JSON.stringify({ text: 'hi' }),
  clientParams,
  toolName: 'echo',
});

describe('MCPService over the SSRF-safe transport (`ssrfSafe` params)', () => {
  it('lists the tools of a loopback server without the guard', async () => {
    const tools = await new MCPService().listRawTools(params());

    expect(tools.map((tool) => tool.name)).toEqual(['echo']);
  });

  it('refuses to reach a loopback server with the guard', async () => {
    delete process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS;

    await expect(new MCPService().listRawTools(guarded())).rejects.toThrow(/SSRF blocked/);
  });

  it('reaches it through the guarded transport where the deployment allows private addresses', async () => {
    process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS = '1';

    const tools = await new MCPService().listRawTools(guarded());

    expect(tools.map((tool) => tool.name)).toEqual(['echo']);
  });

  it('never hands a guarded listing the cached unguarded session', async () => {
    const service = new MCPService();
    await service.listRawTools(params());
    delete process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS;

    await expect(service.listRawTools(guarded())).rejects.toThrow(/SSRF blocked/);
  });

  it('guards tool calls too, not only the listing', async () => {
    const service = new MCPService();
    expect(await service.callTool(echo(params()))).toMatchObject({ content: 'hi', success: true });
    delete process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS;

    await expect(service.callTool(echo(guarded()))).rejects.toThrow(/SSRF blocked/);
  });

  it('runs a tool through the guarded transport where the deployment allows private addresses', async () => {
    process.env.SSRF_ALLOW_PRIVATE_IP_ADDRESS = '1';

    expect(await new MCPService().callTool(echo(guarded()))).toMatchObject({
      content: 'hi',
      success: true,
    });
  });
});
