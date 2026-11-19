import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { Hono } from 'hono';

import { getServerDB } from '@/database/core/db-adaptor';

import { mcpContextFromHono } from '../mcp/context';
import { createLobeHubMcpServer } from '../mcp/server';
import { requireAuth } from '../middleware/auth';

/** Reported to MCP clients as the server version in `initialize`. */
export const LOBEHUB_MCP_SERVER_VERSION = '1.0.0';

/**
 * `/api/v1/mcp` — LobeHub as an MCP server over Streamable HTTP, for Claude
 * Code, Codex, Cursor and other MCP clients.
 *
 * Authenticated like every other route (API key or OIDC token as a Bearer
 * token, `X-Workspace-Id` for a workspace), by the app-level middlewares. The
 * endpoint is stateless: each POST builds a server for this caller, answers
 * the JSON-RPC message(s) as JSON and is done, so it scales like the REST API
 * and needs no session affinity. Server-initiated streams (GET) and session
 * teardown (DELETE) therefore answer 405.
 *
 * Not part of the OpenAPI document (exempted in `scripts/generate-openapi.ts`,
 * like the Anthropic / OpenAI protocol routes): it speaks JSON-RPC, not REST,
 * and SDK users reach the same capabilities through the REST resources.
 */
const McpRoutes = new Hono();

McpRoutes.on(['GET', 'DELETE'], '/', (c) =>
  c.json(
    {
      error: {
        code: -32_000,
        message: 'Method not allowed: this MCP server is stateless; POST JSON-RPC messages.',
      },
      id: null,
      jsonrpc: '2.0',
    },
    405,
    { Allow: 'POST' },
  ),
);

McpRoutes.post('/', requireAuth, async (c) => {
  const db = await getServerDB();
  const server = createLobeHubMcpServer(mcpContextFromHono(c, db), LOBEHUB_MCP_SERVER_VERSION);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    // JSON responses are complete once returned; nothing outlives the request.
    void server.close();
  }
});

export default McpRoutes;
