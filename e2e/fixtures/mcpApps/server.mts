import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFileSync, writeFile } from 'node:fs';
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';

const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';
const DEFAULT_PORT = 39742;
const MCP_ENDPOINT = '/mcp';
const FIXTURE_HTML = readFileSync(new URL('./app.html', import.meta.url), 'utf8');
const appendFileAsync = promisify(appendFile);
const mkdirAsync = promisify(mkdir);
const writeFileAsync = promisify(writeFile);
const callLogPath = path.resolve(
  process.env.MCP_APP_FIXTURE_CALL_LOG ?? '/tmp/mcp-apps-fixture-calls.jsonl',
);

type UiModes = 'inline' | 'fullscreen';

type FixtureResource = {
  name: string;
  uri: string;
  title: string;
  preferredDisplayMode?: UiModes;
  availableDisplayModes?: UiModes[];
  appAvailableDisplayModes?: UiModes[];
  hostNamespace?: 'openai/ui' | 'lobehub/ui';
};

const resources: FixtureResource[] = [
  {
    name: 'inline-preference',
    uri: 'ui://mcp-apps/inline-preference',
    title: 'Tool preference: inline',
    preferredDisplayMode: 'fullscreen',
    availableDisplayModes: ['inline', 'fullscreen'],
    hostNamespace: 'openai/ui',
  },
  {
    name: 'fullscreen-preference',
    uri: 'ui://mcp-apps/fullscreen-preference',
    title: 'Tool preference: fullscreen',
    preferredDisplayMode: 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
    hostNamespace: 'openai/ui',
  },
  {
    name: 'resource-modes-no-tool-preference',
    uri: 'ui://mcp-apps/resource-modes-no-tool-preference',
    title: 'Resource preference without tool preference',
    availableDisplayModes: ['inline', 'fullscreen'],
    hostNamespace: 'lobehub/ui',
  },
  {
    name: 'resource-fullscreen-preference',
    uri: 'ui://mcp-apps/resource-fullscreen-preference',
    title: 'Resource fullscreen preference without tool preference',
    preferredDisplayMode: 'fullscreen',
    availableDisplayModes: ['inline', 'fullscreen'],
    hostNamespace: 'lobehub/ui',
  },
  {
    name: 'resource-inline-only-caps',
    uri: 'ui://mcp-apps/resource-inline-only-caps',
    title: 'Resource inline-only display capability',
    preferredDisplayMode: 'inline',
    availableDisplayModes: ['inline'],
    appAvailableDisplayModes: ['inline', 'fullscreen'],
    hostNamespace: 'lobehub/ui',
  },
  {
    name: 'resource-app-inline-only-caps',
    uri: 'ui://mcp-apps/resource-app-inline-only-caps',
    title: 'App inline-only display capability',
    preferredDisplayMode: 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
    appAvailableDisplayModes: ['inline'],
    hostNamespace: 'lobehub/ui',
  },
  {
    name: 'thread-entrypoint',
    uri: 'ui://mcp-apps/thread-entrypoint',
    title: 'Thread entrypoint with empty configuration',
    preferredDisplayMode: 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
    hostNamespace: 'openai/ui',
  },
  {
    name: 'legacy-output-template',
    uri: 'ui://mcp-apps/legacy-output-template',
    title: 'Legacy outputTemplate resource',
    preferredDisplayMode: 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
    hostNamespace: 'openai/ui',
  },
  {
    name: 'conflict-openai-winner',
    uri: 'ui://mcp-apps/conflict-openai-winner',
    title: 'Conflict loser: openai/ui',
    preferredDisplayMode: 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
    hostNamespace: 'openai/ui',
  },
  {
    name: 'conflict-lobehub-winner',
    uri: 'ui://mcp-apps/conflict-lobehub-winner',
    title: 'Conflict winner: lobehub/ui',
    preferredDisplayMode: 'fullscreen',
    availableDisplayModes: ['inline', 'fullscreen'],
    hostNamespace: 'lobehub/ui',
  },
  {
    name: 'app-only-tool',
    uri: 'ui://mcp-apps/app-only-tool',
    title: 'App-only tool visibility probe',
    preferredDisplayMode: 'inline',
    availableDisplayModes: ['inline', 'fullscreen'],
    hostNamespace: 'openai/ui',
  },
];

const resourceMeta = (resource: FixtureResource) => ({
  ui: { prefersBorder: true },
  [resource.hostNamespace ?? 'openai/ui']: {
    availableDisplayModes: resource.availableDisplayModes,
    preferredDisplayMode: resource.preferredDisplayMode,
  },
});

const renderResource = (resource: FixtureResource) => {
  const fixtureConfig = JSON.stringify({
    label: resource.title,
    resourceUri: resource.uri,
    appAvailableDisplayModes: resource.appAvailableDisplayModes ?? ['inline', 'fullscreen'],
  }).replaceAll('<', '\\u003c');

  return FIXTURE_HTML.replace('__FIXTURE_CONFIG__', fixtureConfig);
};

const toolMetadata = (
  resourceUri: string,
  preferredModelDisplayMode?: UiModes,
  entrypoints?: Array<{ type: 'thread' }>,
  visibility?: string[],
) => ({
  'ui': {
    resourceUri,
    ...(visibility ? { visibility } : {}),
  },
  'openai/ui': {
    ...(preferredModelDisplayMode ? { preferredModelDisplayMode } : {}),
    ...(entrypoints ? { entrypoints } : {}),
  },
});

const registerFixtureResources = (server: McpServer) => {
  for (const resource of resources) {
    const metadata = resourceMeta(resource);
    server.registerResource(
      resource.name,
      resource.uri,
      {
        description: resource.title,
        mimeType: RESOURCE_MIME_TYPE,
        _meta: metadata,
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: RESOURCE_MIME_TYPE,
            text: renderResource(resource),
            _meta: metadata,
          },
        ],
      }),
    );
  }
};

type FixtureToolCall = {
  args: Record<string, unknown>;
  calledAt: string;
  id: string;
  name: string;
};
const fixtureToolCalls: FixtureToolCall[] = [];

const registerFixtureTools = (server: McpServer) => {
  const registerTool = (
    name: string,
    resourceUri: string,
    description: string,
    metadata: Record<string, unknown>,
  ) => {
    server.registerTool(
      name,
      {
        title: name,
        description,
        inputSchema: {},
        _meta: metadata,
      },
      async (args) => {
        const call = { args, calledAt: new Date().toISOString(), id: randomUUID(), name };
        fixtureToolCalls.push(call);
        await appendFileAsync(callLogPath, `${JSON.stringify(call)}\n`);
        return {
          content: [{ type: 'text', text: `MCP Apps fixture result: ${name}` }],
          structuredContent: { fixture: 'mcp-apps', tool: name, resourceUri },
        };
      },
    );
  };

  registerTool(
    'fixture_inline_preference',
    'ui://mcp-apps/resource-fullscreen-preference',
    'Open the MCP Apps inline preference fixture.',
    toolMetadata('ui://mcp-apps/resource-fullscreen-preference', 'inline'),
  );
  registerTool(
    'fixture_fullscreen_preference',
    'ui://mcp-apps/fullscreen-preference',
    'Open the MCP Apps fullscreen preference fixture.',
    toolMetadata('ui://mcp-apps/fullscreen-preference', 'fullscreen'),
  );
  registerTool(
    'fixture_resource_modes_no_tool_preference',
    'ui://mcp-apps/resource-modes-no-tool-preference',
    'Open a resource that declares inline and fullscreen with no tool mode preference.',
    { ui: { resourceUri: 'ui://mcp-apps/resource-modes-no-tool-preference' } },
  );
  registerTool(
    'fixture_resource_fullscreen_preference_no_tool_mode',
    'ui://mcp-apps/resource-fullscreen-preference',
    'Resource preference is fullscreen and this tool has no display-mode preference.',
    { ui: { resourceUri: 'ui://mcp-apps/resource-fullscreen-preference' } },
  );
  registerTool(
    'fixture_resource_inline_only_caps',
    'ui://mcp-apps/resource-inline-only-caps',
    'Resource permits inline only while the app declares inline and fullscreen.',
    { ui: { resourceUri: 'ui://mcp-apps/resource-inline-only-caps' } },
  );
  registerTool(
    'fixture_app_inline_only_caps',
    'ui://mcp-apps/resource-app-inline-only-caps',
    'App advertises inline only while resource and desktop host allow both modes.',
    { ui: { resourceUri: 'ui://mcp-apps/resource-app-inline-only-caps' } },
  );
  registerTool(
    'fixture_thread_entrypoint',
    'ui://mcp-apps/thread-entrypoint',
    'Open the app through an empty thread entrypoint configuration.',
    toolMetadata('ui://mcp-apps/thread-entrypoint', 'inline', [{ type: 'thread' }]),
  );
  registerTool(
    'fixture_legacy_output_template',
    'ui://mcp-apps/legacy-output-template',
    'Open the app through the legacy openai/outputTemplate resource pointer.',
    { 'openai/outputTemplate': 'ui://mcp-apps/legacy-output-template' },
  );
  registerTool(
    'fixture_ui_metadata_conflict',
    'ui://mcp-apps/conflict-lobehub-winner',
    'Open the fixture with conflicting openai/ui and lobehub/ui metadata.',
    {
      'ui': { resourceUri: 'ui://mcp-apps/conflict-lobehub-winner' },
      'openai/ui': {
        preferredModelDisplayMode: 'inline',
        entrypoints: [{ type: 'thread' }],
      },
      'lobehub/ui': {
        preferredModelDisplayMode: 'fullscreen',
      },
    },
  );
  registerTool(
    'fixture_app_only_tool',
    'ui://mcp-apps/app-only-tool',
    'App-only action; it must be excluded from the model tool list.',
    toolMetadata('ui://mcp-apps/app-only-tool', 'inline', undefined, ['app']),
  );
  registerTool(
    'fixture_disabled_model_tool',
    'ui://mcp-apps/inline-preference',
    'Disable this model tool in the conversation tool settings to verify it cannot run.',
    toolMetadata('ui://mcp-apps/inline-preference', 'inline'),
  );
};

const addCorsHeaders = (headers: Headers) => {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Accept, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID',
  );
  headers.set('Access-Control-Expose-Headers', 'MCP-Protocol-Version, MCP-Session-Id');
  return headers;
};

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const toWebRequest = async (request: IncomingMessage) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const method = request.method ?? 'GET';
  const headers = new Headers();

  for (const [name, value] of Object.entries(request.headers)) {
    if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }

  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(request);

  return new Request(url, { method, headers, body });
};

const writeWebResponse = async (
  response: Response,
  responseWriter: import('node:http').ServerResponse,
) => {
  const headers = addCorsHeaders(new Headers(response.headers));
  responseWriter.writeHead(response.status, Object.fromEntries(headers.entries()));

  if (!response.body) {
    responseWriter.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      responseWriter.write(Buffer.from(value));
    }
    responseWriter.end();
  } catch (error) {
    responseWriter.destroy(error instanceof Error ? error : new Error(String(error)));
  } finally {
    reader.releaseLock();
  }
};

export const createMcpAppsFixtureServer = async (port = DEFAULT_PORT) => {
  const sessions = new Map<
    string,
    { server: McpServer; transport: WebStandardStreamableHTTPServerTransport }
  >();
  const createSession = async () => {
    const server = new McpServer({ name: 'lobehub-mcp-apps-acceptance-fixture', version: '1.0.0' });
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
      sessionIdGenerator: () => randomUUID(),
    });
    registerFixtureResources(server);
    registerFixtureTools(server);
    await server.connect(transport);
    return { server, transport };
  };

  const httpServer: HttpServer = createServer(async (request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (request.method === 'OPTIONS') {
      response.writeHead(204, Object.fromEntries(addCorsHeaders(new Headers()).entries()));
      response.end();
      return;
    }

    if (path === '/health') {
      response.writeHead(200, addCorsHeaders(new Headers({ 'Content-Type': 'application/json' })));
      response.end(JSON.stringify({ ok: true, endpoint: MCP_ENDPOINT }));
      return;
    }

    if (path === '/__fixture/calls' && request.method === 'GET') {
      response.writeHead(200, addCorsHeaders(new Headers({ 'Content-Type': 'application/json' })));
      response.end(JSON.stringify({ count: fixtureToolCalls.length, calls: fixtureToolCalls }));
      return;
    }

    if (path === '/__fixture/sessions' && request.method === 'GET') {
      response.writeHead(200, addCorsHeaders(new Headers({ 'Content-Type': 'application/json' })));
      response.end(JSON.stringify({ count: sessions.size, sessionIds: [...sessions.keys()] }));
      return;
    }

    if (path !== MCP_ENDPOINT) {
      response.writeHead(404, addCorsHeaders(new Headers({ 'Content-Type': 'text/plain' })));
      response.end('Not found');
      return;
    }

    try {
      const sessionId = request.headers['mcp-session-id'];
      let session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
      if (typeof sessionId === 'string' && !session) {
        response.writeHead(
          404,
          addCorsHeaders(new Headers({ 'Content-Type': 'application/json' })),
        );
        response.end(
          JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unknown session' } }),
        );
        return;
      }
      if (!session) session = await createSession();
      const webRequest = await toWebRequest(request);
      const webResponse = await session.transport.handleRequest(webRequest);
      const assignedSessionId = webResponse.headers.get('mcp-session-id');
      if (assignedSessionId) sessions.set(assignedSessionId, session);
      await writeWebResponse(webResponse, response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.writeHead(500, addCorsHeaders(new Headers({ 'Content-Type': 'application/json' })));
      response.end(JSON.stringify({ error: 'MCP fixture request failed', message }));
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once('error', rejectListen);
    httpServer.listen(port, '127.0.0.1', () => {
      httpServer.removeListener('error', rejectListen);
      resolveListen();
    });
  });

  const address = httpServer.address();
  if (!address || typeof address === 'string')
    throw new Error('Fixture server did not bind a TCP port.');

  await mkdirAsync(path.dirname(callLogPath), { recursive: true });
  await writeFileAsync(callLogPath, '');

  return {
    endpoint: `http://localhost:${address.port}${MCP_ENDPOINT}`,
    port: address.port,
    close: async () => {
      await Promise.all([...sessions.values()].map(({ server }) => server.close()));
      sessions.clear();
      await new Promise<void>((resolveClose, rejectClose) => {
        httpServer.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    },
  };
};

const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const port = Number(process.env.MCP_APP_FIXTURE_PORT ?? DEFAULT_PORT);
  const fixture = await createMcpAppsFixtureServer(port);
  console.log(`MCP Apps fixture: ${fixture.endpoint}`);
  console.log(`Readiness probe: http://localhost:${fixture.port}/health`);

  const stop = () => {
    void fixture.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
