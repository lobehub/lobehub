import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import {
  createMcpHandler,
  inputRequired,
  McpServer,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';

type ResultRewrite = (method: string | undefined, result: Record<string, any>) => void;

/** Drop the 2026-07-28 caching hints, as a server built on a draft of that revision does. */
const dropCacheHints: ResultRewrite = (_method, result) => {
  delete result.ttlMs;
  delete result.cacheScope;
};

/**
 * Modern paths whose replies are rewritten after the real SDK server answers:
 * `/modern-no-cache-hints` omits `ttlMs` / `cacheScope`, and
 * `/modern-broken-tools` also lists a tool without its required `inputSchema`.
 */
const MODERN_REWRITES: Record<string, ResultRewrite> = {
  '/modern-broken-tools': (method, result) => {
    dropCacheHints(method, result);
    if (method === 'tools/list' && Array.isArray(result.tools)) delete result.tools[0]?.inputSchema;
  },
  '/modern-no-cache-hints': dropCacheHints,
};

/** Apply `rewrite` to the JSON-RPC result in a JSON or SSE response body. */
const rewriteResultBody = (
  body: string,
  method: string | undefined,
  rewrite: ResultRewrite,
): string => {
  const rewriteJson = (json: string) => {
    const message = JSON.parse(json);
    if (message && typeof message.result === 'object' && message.result)
      rewrite(method, message.result);
    return JSON.stringify(message);
  };
  if (body.trimStart().startsWith('{')) return rewriteJson(body);
  return body.replaceAll(/^data: (.+)$/gm, (_line, json: string) => `data: ${rewriteJson(json)}`);
};

/** Real SDK servers shared by client integration tests and local acceptance. */
export async function startNegotiationServers(port = 0) {
  const requests: {
    authorization: string | null;
    method?: string;
    path: string;
    response?: string;
    session: string | null;
  }[] = [];
  const makeServer = () => {
    const server = new McpServer({
      name: 'negotiation-fixture',
      title: 'Negotiation fixture',
      version: 'v1.2.3',
    });
    server.registerTool('echo', { description: 'Return an acceptance marker' }, async () => ({
      content: [{ text: 'MCP negotiation tool succeeded', type: 'text' }],
    }));
    server.registerTool(
      'needs_input',
      { description: 'Requires an unsupported continuation' },
      // A state-only input_required is valid without declaring elicitation.
      // This exercises the result boundary on the unmodified product client.
      async () => inputRequired({ requestState: 'fixture-continuation' }),
    );
    return server;
  };
  const modern = createMcpHandler(makeServer, { legacy: 'reject' });
  const sessions = new Map<
    string,
    { server: McpServer; transport: WebStandardStreamableHTTPServerTransport }
  >();

  const http = createServer(async (req, res) => {
    try {
      // No standalone SSE stream is needed for these request/response fixtures.
      if (req.method === 'GET') {
        res.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      const request = new Request(`http://localhost${req.url}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        ...(body ? { body } : {}),
      });
      const path = new URL(request.url).pathname;
      const entry: (typeof requests)[number] = {
        path,
        method: body ? JSON.parse(body).method : undefined,
        authorization: request.headers.get('authorization'),
        session: request.headers.get('mcp-session-id'),
      };
      requests.push(entry);
      let response: Response;
      if (path === '/401' || path === '/403' || path === '/503') {
        response = new Response('fixture rejection', { status: Number(path.slice(1)) });
      } else if (path === '/timeout') {
        response = new Response(null, { status: 202 });
      } else if (path === '/legacy') {
        const existing = sessions.get(request.headers.get('mcp-session-id') ?? '');
        const session = existing ?? {
          server: makeServer(),
          transport: new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID,
            enableJsonResponse: true,
          }),
        };
        if (!existing) await session.server.connect(session.transport);
        response = await session.transport.handleRequest(request);
        if (session.transport.sessionId) sessions.set(session.transport.sessionId, session);
        else await session.server.close();
      } else if (MODERN_REWRITES[path]) {
        const answer = await modern.fetch(request);
        const text = answer.body
          ? rewriteResultBody(await answer.text(), entry.method, MODERN_REWRITES[path])
          : null;
        const headers = new Headers(answer.headers);
        headers.delete('content-length');
        response = new Response(text, { headers, status: answer.status });
      } else {
        response = await modern.fetch(request);
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) {
        res.end();
        return;
      }
      // Modern replies may use SSE; forward chunks rather than buffering an open stream.
      const output: Uint8Array[] = [];
      for await (const chunk of response.body) {
        output.push(chunk);
        res.write(chunk);
      }
      entry.response = Buffer.concat(output).toString();
      res.end();
    } catch (error) {
      console.error('MCP fixture request failed', error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve) => http.listen(port, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  return {
    requests,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await modern.close();
      await Promise.all([...sessions.values()].map((session) => session.server.close()));
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
