// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Hono } from 'hono';
import OpenAI from 'openai';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/v1/mcp` driven by the official MCP SDK client over a real HTTP port:
 * the real `McpRoutes` behind the same auth + workspace middlewares `app.ts` mounts, the real tool
 * registry, the openapi services it calls and the real agent runtime, on a
 * PGlite database. API keys are real `api_keys` rows, so scope filtering and
 * workspace binding run exactly as in production. Only the database handle,
 * object storage and the LLM are stand-ins. `MCP_TEST_LOG=1` prints every
 * JSON-RPC exchange.
 */
Object.assign(process.env, { NODE_ENV: process.env.NODE_ENV ?? 'test' });
process.env.KEY_VAULTS_SECRET ??= Buffer.alloc(32, 7).toString('base64');
process.env.OPENAI_API_KEY = 'sk-test-fake-api-key-for-testing';

const holder = vi.hoisted(() => ({
  objects: new Map<string, Uint8Array>(),
  serverDB: undefined as unknown,
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: async () => holder.serverDB,
}));

/** In-memory object storage in place of S3. */
vi.mock('@/server/modules/S3', () => ({
  FileS3: class {
    createPreSignedUrlForPreview = async (key: string) => `https://s3.test/${key}?signed`;
    deleteFile = async (key: string) => void holder.objects.delete(key);
    getFileByteArray = async (key: string) => holder.objects.get(key) ?? new Uint8Array();
    getFileContent = async (key: string) => new TextDecoder().decode(holder.objects.get(key));
    uploadBuffer = async (key: string, buffer: Buffer) =>
      void holder.objects.set(key, new Uint8Array(buffer));
  },
}));
vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFullFileUrl = async (path: string) => (path ? `https://s3.test/${path}` : '');
  },
}));
vi.mock('@/server/services/document', () => ({
  DocumentService: class {
    parseFile = async (fileId: string) => {
      const { files } = await import('@/database/schemas');
      const { eq } = await import('drizzle-orm');
      const [file] = await (holder.serverDB as any)
        .select()
        .from(files)
        .where(eq(files.id, fileId));
      const content = new TextDecoder().decode(holder.objects.get(file.url));
      return { content, pages: [], title: file.name, totalCharCount: content.length };
    };
  },
}));

const { getTestDB } = await import('@/database/core/getTestDB');
const {
  agents,
  apiKeys,
  files,
  knowledgeBases,
  messages,
  topics,
  users,
  workspaceMembers,
  workspaces,
} = await import('@/database/schemas');
const { hashApiKey } = await import('@lobechat/utils/server');
const { HTTPException } = await import('hono/http-exception');
const { errorInitFromException, renderApiError } = await import('../common/errors');
const { userAuthMiddleware } = await import('../middleware/auth');
const { workspaceAuthMiddleware } = await import('../middleware/workspace');
const McpRoutes = (await import('./mcp.route')).default;

const serverDB = await getTestDB();
holder.serverDB = serverDB;

const app = new Hono().basePath('/api/v1');
app.onError((error, c) =>
  error instanceof HTTPException
    ? renderApiError(c, errorInitFromException(error))
    : renderApiError(c, { message: error.message, status: 500 }),
);
app.use('*', userAuthMiddleware);
app.use('*', workspaceAuthMiddleware);
app.route('/mcp', McpRoutes);

const OWNER = 'e1-mcp-owner';
const STRANGER = 'e1-mcp-stranger';
const WORKSPACE = 'e1-mcp-ws';
const FINAL_ANSWER = 'The release notes are ready.';
let MCP_URL: string;

/** Serve the app on a real port, the way the Next.js route hands it requests. */
const httpServer = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers))
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  const response = await app.fetch(
    new Request(`http://${req.headers.host}${req.url}`, {
      body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      headers,
      method: req.method,
    }),
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});

beforeAll(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  MCP_URL = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/api/v1/mcp`;
});
afterAll(() => new Promise<void>((resolve) => httpServer.close(() => resolve())));

/** `fetch`, printing each JSON-RPC request and response when `MCP_TEST_LOG=1`. */
const loggingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (process.env.MCP_TEST_LOG !== '1') return response;
  const auth = new Headers(init?.headers).get('authorization')?.slice(0, 18);
  const body = await response.clone().text();
  console.info(
    `--> ${init?.method ?? 'GET'} ${String(input)} (Authorization: ${auth}…)\n${String(init?.body ?? '')}\n<-- ${response.status}\n${body}\n`,
  );
  return response;
};

/** `sk-lh-` + 16 lowercase alphanumerics — the format the auth middleware checks. */
const KEYS = {
  chatOnly: 'sk-lh-e1mcpchatonly001',
  full: 'sk-lh-e1mcpfullaccess1',
  noModel: 'sk-lh-e1mcpnomodelinv1',
  stranger: 'sk-lh-e1mcpstranger001',
  workspace: 'sk-lh-e1mcpworkspace01',
} as const;

const ALL_TOOLS = [
  'get_agent',
  'get_run',
  'get_topic',
  'list_agents',
  'list_files',
  'list_knowledge_bases',
  'read_file',
  'run_agent',
  'search_messages',
  'search_topics',
  'upload_file',
];

const clients: Client[] = [];

/** An MCP SDK client speaking Streamable HTTP to the served app. */
const connect = async (key: string, headers: Record<string, string> = {}) => {
  const client = new Client({ name: 'e1-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: loggingFetch,
    requestInit: { headers: { authorization: `Bearer ${key}`, ...headers } },
  });
  await client.connect(transport);
  clients.push(client);
  return client;
};

const callJson = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = await client.callTool({ arguments: args, name });
  return { ...result, data: result.structuredContent as any };
};

const errorText = (result: { content?: unknown }) =>
  (result.content as { text: string }[])[0]?.text ?? '';

let agentId: string;
let strangerAgentId: string;
let workspaceAgentId: string;
let topicId: string;
let strangerTopicId: string;

beforeEach(async () => {
  holder.objects.clear();
  for (const table of [
    files,
    messages,
    topics,
    agents,
    knowledgeBases,
    apiKeys,
    workspaceMembers,
    workspaces,
    users,
  ])
    await serverDB.delete(table);

  await serverDB.insert(users).values([{ id: OWNER }, { id: STRANGER }]);
  await serverDB
    .insert(workspaces)
    .values({ id: WORKSPACE, name: 'E1 MCP', primaryOwnerId: OWNER, slug: 'e1-mcp' });
  await serverDB
    .insert(workspaceMembers)
    .values({ role: 'owner', userId: OWNER, workspaceId: WORKSPACE });

  const key = (value: string, userId: string, scopes: string[], workspaceId?: string) => ({
    key: value,
    keyHash: hashApiKey(value),
    name: value,
    scopes,
    userId,
    workspaceId: workspaceId ?? null,
  });
  await serverDB
    .insert(apiKeys)
    .values([
      key(KEYS.full, OWNER, ['*']),
      key(KEYS.chatOnly, OWNER, ['chat:read']),
      key(KEYS.noModel, OWNER, ['agent:read', 'run:write']),
      key(KEYS.stranger, STRANGER, ['*']),
      key(KEYS.workspace, OWNER, ['*'], WORKSPACE),
    ]);

  const agentRow = (title: string, userId: string, workspaceId?: string) => ({
    model: 'gpt-5-pro',
    plugins: [],
    provider: 'openai',
    systemRole: 'You write release notes.',
    title,
    userId,
    workspaceId: workspaceId ?? null,
  });
  [{ id: agentId }, { id: strangerAgentId }, { id: workspaceAgentId }] = await serverDB
    .insert(agents)
    .values([
      agentRow('Release Writer', OWNER),
      agentRow('Stranger Agent', STRANGER),
      agentRow('Workspace Helper', OWNER, WORKSPACE),
    ])
    .returning({ id: agents.id });

  [{ id: topicId }, { id: strangerTopicId }] = await serverDB
    .insert(topics)
    .values([
      { title: 'Quarterly roadmap', userId: OWNER },
      { title: 'Stranger roadmap', userId: STRANGER },
    ])
    .returning({ id: topics.id });
  await serverDB.insert(messages).values([
    {
      content: 'Plan the roadmap for Q3',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      role: 'user',
      topicId,
      userId: OWNER,
    },
    {
      content: 'Q3 focuses on the MCP server',
      createdAt: new Date('2026-01-01T00:01:00Z'),
      role: 'assistant',
      topicId,
      userId: OWNER,
    },
    {
      content: 'Stranger roadmap secret',
      role: 'user',
      topicId: strangerTopicId,
      userId: STRANGER,
    },
  ]);
  await serverDB.insert(knowledgeBases).values({ name: 'Product docs', userId: OWNER });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe('/api/v1/mcp transport and auth', () => {
  it('refuses a request without credentials', async () => {
    const res = await fetch(MCP_URL, {
      body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tools/list' }),
      headers: {
        'accept': 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('refuses an unknown API key', async () => {
    await expect(connect('sk-lh-e1mcpunknownkey1')).rejects.toThrow();
  });

  it('answers GET with 405: the endpoint is stateless', async () => {
    const res = await fetch(MCP_URL, {
      headers: { authorization: `Bearer ${KEYS.full}` },
      method: 'GET',
    });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('initializes and lists every tool for a full-access key', async () => {
    const client = await connect(KEYS.full);
    expect(client.getServerVersion()).toMatchObject({ name: 'lobehub' });
    expect(client.getInstructions()).toContain('run_agent');
    expect(client.getServerCapabilities()).toMatchObject({ prompts: {}, resources: {}, tools: {} });
    expect(client.getNegotiatedProtocolVersion()).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(ALL_TOOLS);
    const runAgent = tools.find((tool) => tool.name === 'run_agent')!;
    expect(runAgent.inputSchema).toMatchObject({
      properties: { agentId: { type: 'string' }, input: { type: 'string' } },
      required: expect.arrayContaining(['agentId', 'input']),
    });
    expect(tools.find((tool) => tool.name === 'list_agents')!.annotations?.readOnlyHint).toBe(true);
  });

  it("filters tools, resources and prompts by the key's scopes", async () => {
    const client = await connect(KEYS.chatOnly);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'get_topic',
      'search_messages',
      'search_topics',
    ]);

    // A tool outside the key's scopes is not there to call.
    await expect(client.callTool({ arguments: {}, name: 'list_agents' })).rejects.toThrow(
      /Tool list_agents not found/,
    );

    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((template) => template.uriTemplate)).toEqual([
      'lobehub://topics/{topicId}',
    ]);
    await expect(client.readResource({ uri: 'lobehub://agents' })).rejects.toThrow();
  });

  it('needs model:invoke on top of run:write to run an agent', async () => {
    const client = await connect(KEYS.noModel);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('list_agents');
    expect(names).not.toContain('run_agent');
    expect(names).toContain('get_run'); // run:write implies run:read
  });

  it('refuses a personal key that asks for a workspace', async () => {
    await expect(connect(KEYS.full, { 'x-workspace-id': WORKSPACE })).rejects.toThrow(
      /workspace_mismatch/,
    );
  });
});

describe('/api/v1/mcp tools', () => {
  it('lists only the caller’s own agents, scoped to the workspace the key belongs to', async () => {
    const personal = await callJson(await connect(KEYS.full), 'list_agents');
    expect(personal.isError).toBeFalsy();
    expect(personal.data.agents.map((agent: any) => agent.id)).toEqual([agentId]);

    const workspace = await callJson(await connect(KEYS.workspace), 'list_agents');
    expect(workspace.data.agents.map((agent: any) => agent.id)).toEqual([workspaceAgentId]);

    const filtered = await callJson(await connect(KEYS.full), 'list_agents', {
      keyword: 'nothing',
    });
    expect(filtered.data.agents).toEqual([]);
  });

  it("does not read another user's agent", async () => {
    const client = await connect(KEYS.full);
    expect((await callJson(client, 'get_agent', { agentId })).data).toMatchObject({
      id: agentId,
      systemRole: 'You write release notes.',
    });
    const refused = await callJson(client, 'get_agent', { agentId: strangerAgentId });
    expect(refused.isError).toBe(true);
    expect(errorText(refused)).toMatch(/^40[34]/);
  });

  it('searches topics and messages, and reads a topic, without leaking other users’', async () => {
    const client = await connect(KEYS.chatOnly);

    const found = await callJson(client, 'search_topics', { keyword: 'roadmap' });
    expect(found.data.topics.map((topic: any) => topic.id)).toEqual([topicId]);

    const hits = await callJson(client, 'search_messages', { keyword: 'roadmap' });
    expect(hits.data.messages.map((message: any) => message.content)).toEqual([
      'Plan the roadmap for Q3',
    ]);

    const topic = await callJson(client, 'get_topic', { topicId });
    expect(topic.data.topic).toMatchObject({ id: topicId, title: 'Quarterly roadmap' });
    expect(topic.data.messages.map((message: any) => message.role)).toEqual(['user', 'assistant']);
    expect(topic.data.messageTotal).toBe(2);

    // A long conversation is read from its tail, still oldest first.
    const tail = await callJson(client, 'get_topic', { messageLimit: 1, topicId });
    expect(tail.data.messages.map((message: any) => message.content)).toEqual([
      'Q3 focuses on the MCP server',
    ]);

    const refused = await callJson(client, 'get_topic', { topicId: strangerTopicId });
    expect(refused.isError).toBe(true);
    expect(errorText(refused)).toMatch(/^40[34]/);
  });

  it('rejects invalid arguments', async () => {
    const client = await connect(KEYS.chatOnly);
    const invalid = await client.callTool({ arguments: { keyword: '' }, name: 'search_messages' });
    expect(invalid.isError).toBe(true);
    expect(errorText(invalid)).toMatch(/keyword/i);
  });

  it('uploads a text file, then lists and reads it back', async () => {
    const client = await connect(KEYS.full);
    const uploaded = await callJson(client, 'upload_file', {
      name: 'notes.md',
      mimeType: 'text/markdown',
      text: '# Notes\nShip the MCP server.',
    });
    expect(uploaded.isError).toBeFalsy();
    const fileId = uploaded.data.file.id;
    expect(uploaded.data.file).toMatchObject({ name: 'notes.md' });

    const listed = await callJson(client, 'list_files', { keyword: 'notes' });
    expect(listed.data.files.map((file: any) => file.id)).toEqual([fileId]);

    const read = await callJson(client, 'read_file', { fileId, maxChars: 7 });
    expect(read.data).toMatchObject({ content: '# Notes', truncated: true });

    const stranger = await callJson(await connect(KEYS.stranger), 'read_file', { fileId });
    expect(stranger.isError).toBe(true);
  });

  it('refuses base64 that does not decode, and data without a mimeType', async () => {
    const client = await connect(KEYS.full);
    const corrupt = await callJson(client, 'upload_file', {
      data: 'not*base64!',
      mimeType: 'application/pdf',
      name: 'a.pdf',
    });
    expect(errorText(corrupt)).toBe('400: `data` is not valid base64');
    const untyped = await callJson(client, 'upload_file', { data: 'aGk=', name: 'a.bin' });
    expect(errorText(untyped)).toBe('400: `mimeType` is required with `data`');

    const binary = await callJson(client, 'upload_file', {
      data: Buffer.from('%PDF-1.7').toString('base64'),
      mimeType: 'application/pdf',
      name: 'spec.pdf',
    });
    expect(binary.isError).toBeFalsy();
    expect(binary.data.file).toMatchObject({ fileType: 'application/pdf', name: 'spec.pdf' });

    // Unpadded and URL-safe base64 decode too.
    const unpadded = await callJson(client, 'upload_file', {
      data: Buffer.from('hi?>').toString('base64url'),
      mimeType: 'text/plain',
      name: 'b.txt',
    });
    expect(unpadded.isError).toBeFalsy();
  });

  it('refuses an upload with both text and data', async () => {
    const client = await connect(KEYS.full);
    const refused = await callJson(client, 'upload_file', {
      data: 'aGk=',
      name: 'a.txt',
      text: 'hi',
    });
    expect(refused.isError).toBe(true);
    expect(errorText(refused)).toMatch(/^400/);
  });

  it('lists knowledge bases', async () => {
    const result = await callJson(await connect(KEYS.full), 'list_knowledge_bases');
    expect(result.data.knowledgeBases.map((kb: any) => kb.name)).toEqual(['Product docs']);
    const none = await callJson(await connect(KEYS.stranger), 'list_knowledge_bases');
    expect(none.data.knowledgeBases).toEqual([]);
  });
});

describe('/api/v1/mcp run_agent', () => {
  const answerStream = () => {
    const chunks = [
      {
        response: {
          created_at: 0,
          id: 'resp_1',
          model: 'gpt-5-pro',
          object: 'response',
          output: [],
          status: 'in_progress',
        },
        type: 'response.created',
      },
      {
        content_index: 0,
        delta: FINAL_ANSWER,
        item_id: 'msg_1',
        output_index: 0,
        type: 'response.output_text.delta',
      },
      {
        response: {
          created_at: 0,
          id: 'resp_1',
          model: 'gpt-5-pro',
          object: 'response',
          output: [
            {
              content: [{ text: FINAL_ANSWER, type: 'output_text' }],
              id: 'msg_1',
              role: 'assistant',
              status: 'completed',
              type: 'message',
            },
          ],
          status: 'completed',
          usage: { input_tokens: 30, output_tokens: 8, total_tokens: 38 },
        },
        type: 'response.completed',
      },
    ];
    const iterator = () => ({
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) yield chunk;
      },
      toReadableStream: () =>
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
    });
    return Object.assign(iterator(), { tee: () => [iterator(), iterator()] });
  };

  beforeEach(() => {
    vi.spyOn(OpenAI.Responses.prototype, 'create').mockImplementation(
      () => Promise.resolve(answerStream() as any) as any,
    );
  });

  it('runs an agent through the runs service and returns its reply', async () => {
    const client = await connect(KEYS.full);
    const ran = await callJson(client, 'run_agent', {
      agentId,
      input: 'Write the release notes',
      waitSeconds: 30,
    });
    expect(ran.isError).toBeFalsy();
    expect(ran.data).toMatchObject({
      result: { content: FINAL_ANSWER },
      status: 'completed',
    });
    expect(ran.data.id).toBeTruthy();

    // The run is a normal run: readable through get_run, its conversation through get_topic.
    const run = await callJson(client, 'get_run', { runId: ran.data.id });
    expect(run.data).toMatchObject({ id: ran.data.id, status: 'completed' });
    const topic = await callJson(client, 'get_topic', { topicId: ran.data.topicId });
    expect(topic.data.messages.map((message: any) => message.content)).toContain(
      'Write the release notes',
    );
  }, 60_000);

  it('returns the run id at once with waitSeconds 0', async () => {
    const client = await connect(KEYS.full);
    const ran = await callJson(client, 'run_agent', { agentId, input: 'Go', waitSeconds: 0 });
    expect(ran.isError).toBeFalsy();
    expect(ran.data.id).toBeTruthy();
    expect(['queued', 'running', 'completed']).toContain(ran.data.status);
  });

  it('stops waiting once the caller has gone', async () => {
    // A run that never finishes on its own: the model call hangs.
    vi.spyOn(OpenAI.Responses.prototype, 'create').mockImplementation(
      () => new Promise(() => {}) as any,
    );
    const { MCP_TOOLS } = await import('../mcp/tools');
    const runAgent = MCP_TOOLS.find((tool) => tool.name === 'run_agent')!;
    const controller = new AbortController();
    let settled = false;
    const pending = runAgent
      .run(
        {
          apiKeyScopes: null,
          authType: 'apikey',
          db: serverDB,
          signal: controller.signal,
          userId: OWNER,
        },
        { agentId, input: 'Hang', waitSeconds: 120 },
      )
      .then((result) => {
        settled = true;
        return result;
      });

    // The call keeps waiting while the caller is still connected …
    expect(settled).toBe(false);

    // … and returns the pending run — not a completed one — once the caller goes.
    controller.abort();
    const run = (await pending) as { id: string; status: string };
    expect(run.id).toBeTruthy();
    expect(['queued', 'running']).toContain(run.status);
  }, 20_000);

  it("refuses to run another user's agent", async () => {
    const client = await connect(KEYS.full);
    const refused = await callJson(client, 'run_agent', {
      agentId: strangerAgentId,
      input: 'Hi',
      waitSeconds: 0,
    });
    expect(refused.isError).toBe(true);
    expect(errorText(refused)).toMatch(/^40[34]/);
  });
});

describe('/api/v1/mcp resources and prompts', () => {
  it('lists and reads agent and topic resources', async () => {
    const client = await connect(KEYS.full);
    const { resources } = await client.listResources();
    const uris = resources.map((resource) => resource.uri);
    expect(uris).toEqual(
      expect.arrayContaining([
        'lobehub://agents',
        `lobehub://agents/${agentId}`,
        `lobehub://topics/${topicId}`,
      ]),
    );
    expect(uris).not.toContain(`lobehub://topics/${strangerTopicId}`);

    const agentsResource = await client.readResource({ uri: 'lobehub://agents' });
    expect(JSON.parse((agentsResource.contents[0] as any).text).agents[0].id).toBe(agentId);

    const topic = await client.readResource({ uri: `lobehub://topics/${topicId}` });
    expect(JSON.parse((topic.contents[0] as any).text).messages).toHaveLength(2);

    await expect(
      client.readResource({ uri: `lobehub://topics/${strangerTopicId}` }),
    ).rejects.toThrow();
  });

  it('builds the summarize_topic prompt from the conversation', async () => {
    const client = await connect(KEYS.full);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((prompt) => prompt.name)).toEqual(['summarize_topic']);
    const prompt = await client.getPrompt({ arguments: { topicId }, name: 'summarize_topic' });
    expect((prompt.messages[0].content as any).text).toContain('Q3 focuses on the MCP server');
  });
});
