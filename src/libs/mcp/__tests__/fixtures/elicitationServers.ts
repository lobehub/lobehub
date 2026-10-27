import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import {
  createMcpHandler,
  inputRequired,
  McpServer,
  type ServerContext,
  UrlElicitationRequiredError,
  WebStandardStreamableHTTPServerTransport,
} from '@modelcontextprotocol/server';

/** Real SDK servers shared by client integration tests and local acceptance. */
export async function startElicitationServers(port = 0) {
  let publicUrl = '';
  const completed = new Map<string, 'success' | 'failure'>();
  const externalVisits: string[] = [];
  const effects: { tool: string; content: unknown }[] = [];
  const requests: {
    authorization: string | null;
    method?: string;
    params?: unknown;
    requestId?: unknown;
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
    server.registerTool(
      'form',
      { description: 'Elicit two rounds before a side effect' },
      async (ctx: ServerContext) => {
        const params = {
          mode: 'form' as const,
          message: 'Choose a label',
          requestedSchema: {
            type: 'object' as const,
            properties: { label: { type: 'string' as const, minLength: 2 } },
            required: ['label'],
          },
        };
        if (ctx.mcpReq.envelope) {
          const input = ctx.mcpReq.inputResponses?.details as
            { action?: string; content?: { label: string } } | undefined;
          if (!input)
            return inputRequired({
              inputRequests: { details: inputRequired.elicit(params) },
              requestState: 'opaque-state: \u2603',
            });
          if (ctx.mcpReq.requestState() !== 'opaque-state: \u2603')
            throw new Error('Request state was altered');
          if (input.action !== 'accept')
            return { content: [{ type: 'text', text: input.action ?? 'missing' }] };
          return { content: [{ type: 'text', text: `saved:${input.content?.label}` }] };
        }
        const input = await ctx.mcpReq.elicitInput(params, { relatedRequestId: ctx.mcpReq.id });
        return {
          content: [
            {
              type: 'text',
              text: input.action === 'accept' ? `saved:${input.content?.label}` : input.action,
            },
          ],
        };
      },
    );
    for (const tool of ['multi', 'url', 'legacy_url', 'failure', 'hang']) {
      server.registerTool(
        tool,
        { description: `Elicitation acceptance ${tool}` },
        async (ctx: ServerContext) => {
          const urlRequest = {
            mode: 'url' as const,
            message: 'Complete the demo authorization on the external page, then return.',
            url: `${publicUrl}/external/${tool}`,
            elicitationId: tool,
          };
          const form = (round: number) => ({
            mode: 'form' as const,
            message: `Round ${round}: choose a label`,
            requestedSchema: {
              type: 'object' as const,
              properties: {
                [round === 2 ? 'finalLabel' : 'label']: {
                  type: 'string' as const,
                  minLength: 2,
                  default: `round-${round}`,
                },
                choice: {
                  type: 'string' as const,
                  oneOf: [
                    { const: 'a', title: 'Alpha' },
                    { const: 'b', title: 'Beta' },
                  ],
                  default: 'a',
                },
                tags: {
                  type: 'array' as const,
                  items: { type: 'string' as const, enum: ['red', 'green'] },
                  minItems: 1,
                  default: ['red'],
                },
                confirmed: { type: 'boolean' as const, default: false },
                count: { type: 'integer' as const, minimum: 1, maximum: 5, default: 2 },
                email: {
                  type: 'string' as const,
                  format: 'email' as const,
                  default: 'test@example.com',
                },
              },
              required: [
                round === 2 ? 'finalLabel' : 'label',
                'choice',
                'tags',
                'confirmed',
                'count',
                'email',
              ],
            },
          });
          if (tool === 'legacy_url' && !ctx.mcpReq.envelope && !completed.has(tool))
            throw new UrlElicitationRequiredError([urlRequest]);
          const isUrl = tool === 'url' || tool === 'legacy_url';
          let answer;
          if (ctx.mcpReq.envelope) {
            const round = ctx.mcpReq.requestState() === 'round-two' ? 2 : 1;
            answer = ctx.mcpReq.inputResponses?.answer;
            if (!answer || (isUrl && answer.action === 'accept' && !completed.has(tool)))
              return inputRequired({
                inputRequests: {
                  answer: isUrl
                    ? inputRequired.elicitUrl({ message: urlRequest.message, url: urlRequest.url })
                    : inputRequired.elicit(form(round)),
                  ...(tool === 'multi' && round === 1
                    ? {
                        confirm: inputRequired.elicit({
                          mode: 'form',
                          message: 'Confirm the second request',
                          requestedSchema: {
                            type: 'object',
                            properties: { ok: { type: 'boolean', default: true } },
                            required: ['ok'],
                          },
                        }),
                      }
                    : {}),
                },
                requestState: round === 2 ? 'round-two' : 'round-one',
              });
            if (tool === 'multi' && round === 1 && answer.action === 'accept')
              return inputRequired({
                inputRequests: { answer: inputRequired.elicit(form(2)) },
                requestState: 'round-two',
              });
          } else if (tool === 'legacy_url') answer = { action: 'accept' as const };
          else {
            answer = await ctx.mcpReq.elicitInput(isUrl ? urlRequest : form(1), {
              relatedRequestId: ctx.mcpReq.id,
            });
            if (tool === 'multi' && answer.action === 'accept')
              answer = await ctx.mcpReq.elicitInput(form(2), { relatedRequestId: ctx.mcpReq.id });
          }
          if (answer.action !== 'accept')
            return { content: [{ type: 'text', text: `${tool}:${answer.action}` }] };
          if (tool === 'hang') {
            await new Promise((resolve) =>
              ctx.mcpReq.signal.addEventListener('abort', resolve, { once: true }),
            );
            return { content: [{ type: 'text', text: 'aborted' }], isError: true };
          }
          if (tool === 'failure' || (isUrl && completed.get(tool) === 'failure'))
            return { content: [{ type: 'text', text: `${tool}:external failure` }], isError: true };
          effects.push({ tool, content: answer.content });
          return {
            content: [
              { type: 'text', text: `${tool}:completed:${JSON.stringify(answer.content ?? {})}` },
            ],
          };
        },
      );
    }
    return server;
  };
  const modern = createMcpHandler(makeServer, { legacy: 'reject' });
  const sessions = new Map<
    string,
    { server: McpServer; transport: WebStandardStreamableHTTPServerTransport }
  >();

  const http = createServer(async (req, res) => {
    try {
      if (req.url?.startsWith('/external-status/')) {
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ status: completed.get(req.url.split('/')[2]) }));
        return;
      }
      if (req.url?.startsWith('/effect/') && req.method === 'POST') {
        effects.push({ tool: req.url.split('/')[2], content: {} });
        res.writeHead(200).end();
        return;
      }
      if (req.url === '/trace') {
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ requests, externalVisits, effects }));
        return;
      }
      if (req.url?.startsWith('/external/')) {
        externalVisits.push(req.url);
        const target = new URL(req.url, 'http://localhost');
        const tool = target.pathname.split('/')[2];
        if (target.searchParams.has('complete'))
          completed.set(
            tool,
            target.searchParams.get('complete') === 'failure' ? 'failure' : 'success',
          );
        res
          .writeHead(200, { 'Content-Type': 'text/html' })
          .end(
            `<h1>External MCP demo: ${tool}</h1><p>${completed.get(tool) ?? 'Not completed'}</p><a href="?complete=success">Complete successfully</a> <a href="?complete=failure">Fail external operation</a>`,
          );
        return;
      }
      if (req.url === '/ledger') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(effects));
        return;
      }
      // No standalone SSE stream is needed for these request/response fixtures.
      if (req.method === 'GET' && req.url !== '/legacy') {
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
        params: body ? JSON.parse(body).params : undefined,
        requestId: body ? JSON.parse(body).id : undefined,
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
            enableJsonResponse: false,
          }),
        };
        if (!existing) await session.server.connect(session.transport);
        response = await session.transport.handleRequest(request);
        if (session.transport.sessionId) sessions.set(session.transport.sessionId, session);
        else await session.server.close();
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
  publicUrl = `http://127.0.0.1:${address.port}`;
  return {
    effects,
    completed,
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
