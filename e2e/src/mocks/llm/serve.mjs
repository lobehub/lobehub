/**
 * The shared E2E LLM mock endpoint, run as its own process.
 *
 * Plain JavaScript on purpose: `ensureLLMMockServer` (see `./server.ts`) starts
 * it with bare `node`, so it needs no TypeScript loader and does not depend on
 * how the Cucumber worker or the unit-test runner was launched. It exits after
 * `E2E_LLM_MOCK_IDLE_MS` without requests, on `POST /__e2e/shutdown`, and
 * quietly when another process already owns the port.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.E2E_LLM_MOCK_PORT || 3990);
const IDLE_MS = Number(process.env.E2E_LLM_MOCK_IDLE_MS || 10 * 60_000);

const registry = {
  defaultReply: {
    response: 'Hello! I am a mock AI assistant. How can I help you today?',
    responseDelay: 100,
    streamChunkSize: 10,
    streamDelay: 20,
  },
  /** Workers holding each reply; a reply is dropped once the last one clears it. */
  owners: new Map(),
  replies: new Map(),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

/** OpenAI message content can be a string or an array of typed parts. */
const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
      .join('');
  return '';
};

const resolveReply = (messages) => {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const key = textOf(lastUser?.content).toLowerCase().trim();

  if (key) {
    const exact = registry.replies.get(`exact:${key}`);
    if (exact) return exact;
    for (const reply of registry.replies.values()) {
      if (reply.match === 'contains' && key.includes(reply.key)) return reply;
    }
  }

  return registry.defaultReply;
};

/** OpenAI chat-completions SSE chunks for `content`. */
const buildOpenAIChunks = (content, chunkSize, model) => {
  const id = `chatcmpl-e2e-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  const frame = (delta, finishReason = null, extra = {}) =>
    `data: ${JSON.stringify({
      choices: [{ delta, finish_reason: finishReason, index: 0 }],
      created,
      id,
      model,
      object: 'chat.completion.chunk',
      ...extra,
    })}\n\n`;

  const chunks = [frame({ content: '', role: 'assistant' })];
  for (let i = 0; i < content.length; i += Math.max(1, chunkSize)) {
    chunks.push(frame({ content: content.slice(i, i + chunkSize) }));
  }
  chunks.push(
    frame({}, 'stop', { usage: { completion_tokens: 50, prompt_tokens: 10, total_tokens: 60 } }),
    'data: [DONE]\n\n',
  );
  return chunks;
};

const handleChatCompletion = async (req, res) => {
  const body = JSON.parse((await readBody(req)) || '{}');
  const reply = resolveReply(body.messages ?? []);
  const model = body.model || 'mock-model';

  if (body.stream === false) {
    await sleep(reply.responseDelay);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: { content: reply.response, role: 'assistant' },
          },
        ],
        created: Math.floor(Date.now() / 1000),
        id: `chatcmpl-e2e-${Date.now()}`,
        model,
        object: 'chat.completion',
        usage: { completion_tokens: 50, prompt_tokens: 10, total_tokens: 60 },
      }),
    );
    return;
  }

  res.writeHead(200, {
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Content-Type': 'text/event-stream',
  });
  let closed = false;
  req.on('close', () => {
    closed = true;
  });

  await sleep(reply.responseDelay);
  const chunks = buildOpenAIChunks(reply.response, reply.streamChunkSize, model);
  for (let index = 0; index < chunks.length && !closed; index += 1) {
    res.write(chunks[index]);
    if (index < chunks.length - 1) await sleep(reply.streamDelay);
  }
  res.end();
};

const handleRegister = async (req, res) => {
  const payload = JSON.parse((await readBody(req)) || '{}');
  const owner = payload.owner ?? '0';
  // Workers share this endpoint: a clear only releases the caller's hold, so
  // one worker's cleanup cannot drop a reply another worker is still using.
  for (const key of payload.clear ?? []) {
    const owners = registry.owners.get(key);
    owners?.delete(owner);
    if (!owners?.size) {
      registry.owners.delete(key);
      registry.replies.delete(key);
    }
  }
  if (payload.defaultReply) registry.defaultReply = payload.defaultReply;
  for (const reply of payload.replies ?? []) {
    const key = `${reply.match}:${reply.key}`;
    registry.replies.set(key, reply);
    registry.owners.set(key, (registry.owners.get(key) ?? new Set()).add(owner));
  }
  res.writeHead(204);
  res.end();
};

const handle = async (req, res) => {
  const path = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`).pathname;

  try {
    if (req.method === 'POST' && path.endsWith('/chat/completions'))
      return await handleChatCompletion(req, res);
    if (req.method === 'POST' && path === '/__e2e/llm/replies')
      return await handleRegister(req, res);
    if (req.method === 'GET' && path.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [], object: 'list' }));
      return;
    }
    if (req.method === 'POST' && path === '/__e2e/shutdown') {
      res.writeHead(204);
      res.end(() => process.exit(0));
      return;
    }
    if (req.method === 'GET' && path === '/__e2e/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pid: process.pid }));
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (error) {
    console.error('[llm-mock] request failed:', error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
};

let idleTimer;
const armIdle = () => {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => process.exit(0), IDLE_MS);
};

const server = createServer((req, res) => {
  armIdle();
  void handle(req, res);
});
server.once('error', (error) => {
  if (error.code === 'EADDRINUSE') process.exit(0);
  console.error('[llm-mock] failed to listen:', error);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[llm-mock] listening on http://127.0.0.1:${PORT}`);
  armIdle();
});
