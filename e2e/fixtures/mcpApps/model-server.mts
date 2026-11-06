import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import path from 'node:path';

type ChatMessage = { role?: string; content?: unknown; tool_calls?: unknown };
type ChatRequest = {
  model?: string;
  messages?: ChatMessage[];
  tools?: Array<{ type?: string; function?: { name?: string } }>;
};

const port = Number(process.env.MCP_APP_MODEL_PORT ?? 39743);
const logPath = path.resolve(process.env.MCP_APP_MODEL_LOG ?? '/tmp/mcp-apps-model-requests.jsonl');
const toolNames = [
  'fixture_inline_preference',
  'fixture_fullscreen_preference',
  'fixture_resource_modes_no_tool_preference',
  'fixture_thread_entrypoint',
  'fixture_legacy_output_template',
  'fixture_ui_metadata_conflict',
  'fixture_app_only_tool',
  'fixture_disabled_model_tool',
];

const sendJson = (response: import('node:http').ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(value));
};

const readBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
};

const messageText = (message: ChatMessage) => {
  if (typeof message.content === 'string') return message.content;
  return JSON.stringify(message.content ?? '');
};

const selectTool = (body: ChatRequest) => {
  const messages = body.messages ?? [];
  const userIndex = messages.findLastIndex(({ role }) => role === 'user');
  const latestUserMessage = messages[userIndex];
  if (!latestUserMessage) return undefined;
  if (messages.slice(userIndex + 1).some(({ role }) => role === 'tool')) return undefined;
  const text = messageText(latestUserMessage);
  const requested = toolNames.find((name) => text.includes(name));
  if (!requested) return undefined;
  const hashed = `MD5HASH_${createHash('md5').update(requested).digest('hex').slice(0, 12)}`;
  return body.tools
    ?.map(({ function: fn }) => fn?.name)
    .find((name) => {
      const api = name?.split('____')[1];
      return name === requested || api === requested || api === hashed;
    });
};

const contextEcho = (body: ChatRequest) => {
  const contextMessages = (body.messages ?? []).filter(
    ({ role }) => role === 'user' || role === 'system',
  );
  const text = contextMessages.map(messageText).join('\n');
  const marker = 'MCP_APPS_CONTEXT_ONCE__amber-kite-42';
  const markerCount = text.split(marker).length - 1;
  return markerCount > 0
    ? `Fixture received the MCP Apps context marker ${markerCount} time(s): ${marker}`
    : 'Fixture received no MCP Apps context marker.';
};

const sse = (
  response: import('node:http').ServerResponse,
  id: string,
  model: string,
  chunks: unknown[],
) => {
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
  });
  for (const chunk of chunks) {
    response.write(
      `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model, choices: [chunk] })}\n\n`,
    );
  }
  response.write('data: [DONE]\n\n');
  response.end();
};

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    .pathname;
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    response.end();
    return;
  }

  if (request.method === 'GET' && pathname === '/health') {
    sendJson(response, 200, { ok: true, model: 'mcp-apps-fixture' });
    return;
  }

  if (request.method === 'GET' && pathname === '/__fixture/requests') {
    sendJson(response, 200, { logPath, format: 'JSONL; see local log file for full bodies' });
    return;
  }

  if (request.method !== 'POST' || pathname !== '/v1/chat/completions') {
    sendJson(response, 404, { error: { message: 'Not found' } });
    return;
  }

  let body: ChatRequest;
  try {
    body = JSON.parse(await readBody(request)) as ChatRequest;
  } catch {
    sendJson(response, 400, { error: { message: 'Invalid JSON request body' } });
    return;
  }

  const trace = {
    id: randomUUID(),
    receivedAt: new Date().toISOString(),
    method: request.method,
    path: pathname,
    model: body.model,
    request: body,
  };
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(trace)}\n`);

  const id = `chatcmpl-${trace.id}`;
  const model = body.model ?? 'mcp-apps-fixture';
  const selectedTool = selectTool(body);
  if (selectedTool) {
    sse(response, id, model, [
      { index: 0, delta: { role: 'assistant' }, finish_reason: null },
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: `call-${trace.id.slice(0, 12)}`,
              type: 'function',
              function: { name: selectedTool, arguments: '{}' },
            },
          ],
        },
        finish_reason: null,
      },
      { index: 0, delta: {}, finish_reason: 'tool_calls' },
    ]);
    return;
  }

  const content = contextEcho(body);
  sse(response, id, model, [
    { index: 0, delta: { role: 'assistant', content }, finish_reason: null },
    { index: 0, delta: {}, finish_reason: 'stop' },
  ]);
});

await new Promise<void>((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(port, '0.0.0.0', () => {
    server.removeListener('error', rejectListen);
    resolveListen();
  });
});

await mkdir(path.dirname(logPath), { recursive: true });
await writeFile(logPath, '');
console.log(`Local OpenAI-compatible model fixture listening on http://127.0.0.1:${port}/v1`);
console.log(`Request bodies are recorded in ${logPath}`);

const stop = () => server.close(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
