#!/usr/bin/env node
/**
 * llm-stub — local OpenAI-compatible provider for acceptance runs.
 *
 * Lets a check drive a turn to COMPLETION (or to a deterministic provider
 * failure) without any real LLM key: a real HTTP + SSE round trip through the
 * app's whole provider pipeline, same principle as s3rver standing in for S3.
 * Probe the shell for real keys first (M19) — only stub what is provably absent.
 *
 * Implements BOTH protocols the app speaks:
 *   - /v1/chat/completions  (chat-completions SSE chunks)
 *   - /v1/responses         (Responses API — what the server-side openai
 *                            provider actually calls; a chat-only stub 404s,
 *                            and the error body's `endpoint` field is the tell)
 *   - /v1/models            (model listing / connectivity check)
 *
 * Usage:
 *   node .agents/acceptance/scripts/llm-stub.mjs                # :41100
 *   PORT=5xxxx STUB_TEXT="custom reply" STUB_DELAY_MS=200 node …
 *
 * Wire it in through the real store action so the key-vault round trip is
 * exercised too (clear at teardown):
 *   aiInfra().updateAiProviderConfig("openai",
 *     { keyVaults: { apiKey: "sk-stub", baseURL: "http://localhost:41100/v1" } })
 *
 * Failure injection (transport-level error mapping, deterministic):
 *   STUB_FAIL=429|500|529 node …          # every completion request fails
 *   …or per-request: POST …/v1/responses?fail=429
 *
 * Knobs:
 *   PORT           listen port                       (default 41100)
 *   STUB_TEXT      full reply text, split into words (default "STUB SUCCESS: …")
 *   STUB_DELAY_MS  inter-chunk delay — stretch it to hold a generation open
 *                  for Stop/loading-window checks     (default 60)
 *
 * See .agents/acceptance/probe-mock-patterns.md → "A success-path run needs no
 * real provider key" for when to reach for this (and when not to: anything
 * about real model behavior/quality is out of scope by construction).
 */
import http from 'node:http';

const PORT = Number(process.env.PORT || 41100);
const TEXT = process.env.STUB_TEXT || 'STUB SUCCESS: the retried turn completed normally.';
const DELAY = Number(process.env.STUB_DELAY_MS || 60);
const FAIL = process.env.STUB_FAIL;

// Keep each word's leading space so re-joined deltas reproduce TEXT exactly.
const words = TEXT.split(/(?= )/);

const failStatus = (url) => {
  const q = new URL(url, 'http://x').searchParams.get('fail');
  return Number(q || FAIL) || undefined;
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    console.log('REQ', req.method, req.url);

    if (req.url?.includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'stub-model', object: 'model' }], object: 'list' }));
      return;
    }

    const isResponses = req.url?.includes('/responses');
    const isChat = req.url?.includes('/chat/completions');
    if (!isResponses && !isChat) {
      res.writeHead(404).end();
      return;
    }

    const status = failStatus(req.url);
    if (status) {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            code: 'stub_injected_failure',
            message: `stub injected ${status}`,
            type: 'stub',
          },
        }),
      );
      return;
    }

    if (isResponses) {
      res.writeHead(200, {
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'content-type': 'text/event-stream',
      });
      const rid = 'resp_stub_' + Math.random().toString(36).slice(2, 8);
      const ev = (type, extra) => `event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`;
      res.write(ev('response.created', { response: { id: rid, status: 'in_progress' } }));
      let i = 0;
      const t = setInterval(() => {
        if (i < words.length) {
          res.write(ev('response.output_text.delta', { delta: words[i++], item_id: 'msg_stub' }));
        } else {
          clearInterval(t);
          res.write(
            ev('response.completed', {
              response: {
                id: rid,
                status: 'completed',
                usage: {
                  input_tokens: 10,
                  output_tokens: words.length,
                  total_tokens: 10 + words.length,
                },
              },
            }),
          );
          res.end();
        }
      }, DELAY);
      return;
    }

    // chat/completions
    const id = 'chatcmpl-stub-' + Math.random().toString(36).slice(2, 8);
    const created = Math.floor(Date.now() / 1000);
    let model = 'stub-model';
    let stream = true;
    try {
      const payload = JSON.parse(body);
      model = payload.model || model;
      stream = payload.stream !== false && !payload.response_format;
    } catch {
      // Keep the defaults for malformed probe requests.
    }
    if (!stream) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              index: 0,
              message: { content: TEXT, role: 'assistant' },
            },
          ],
          created,
          id,
          model,
          object: 'chat.completion',
          usage: {
            completion_tokens: words.length,
            prompt_tokens: 10,
            total_tokens: 10 + words.length,
          },
        }),
      );
      return;
    }
    res.writeHead(200, {
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      'content-type': 'text/event-stream',
    });
    const chunk = (delta, finish = null) =>
      `data: ${JSON.stringify({
        choices: [{ delta, finish_reason: finish, index: 0 }],
        created,
        id,
        model,
        object: 'chat.completion.chunk',
      })}\n\n`;
    res.write(chunk({ content: '', role: 'assistant' }));
    let i = 0;
    const t = setInterval(() => {
      if (i < words.length) {
        res.write(chunk({ content: words[i++] }));
      } else {
        clearInterval(t);
        res.write(chunk({}, 'stop'));
        res.write('data: [DONE]\n\n');
        res.end();
      }
    }, DELAY);
  });
});

server.listen(PORT, () =>
  console.log(`llm-stub listening on :${PORT} (delay=${DELAY}ms${FAIL ? `, fail=${FAIL}` : ''})`),
);
