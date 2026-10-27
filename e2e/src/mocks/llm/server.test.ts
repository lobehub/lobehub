import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureLLMMockServer, LLM_MOCK_URL, registerLLMReplies } from './server';

const parseContent = (sse: string) =>
  sse
    .split(/(?<=\n\n)/)
    .filter((chunk) => chunk.startsWith('data: {'))
    .map((chunk) => JSON.parse(chunk.slice(6)).choices[0].delta.content ?? '')
    .join('');

/** Ask the shared endpoint (a separate process) for a non-streamed reply. */
const complete = async (content: unknown) => {
  const res = await fetch(`${LLM_MOCK_URL}/v1/chat/completions`, {
    body: JSON.stringify({ messages: [{ content, role: 'user' }], stream: false }),
    method: 'POST',
  });
  return (await res.json()).choices[0].message.content as string;
};

const reply = (key: string, match: 'contains' | 'exact', response: string) => ({
  key,
  match,
  response,
  responseDelay: 0,
  streamChunkSize: 5,
  streamDelay: 0,
});

describe('LLM mock endpoint', { timeout: 20_000 }, () => {
  beforeAll(async () => {
    await ensureLLMMockServer();
  }, 20_000);

  afterAll(async () => {
    await registerLLMReplies({ clear: ['exact:hello server', 'contains:fragment'] });
  });

  // Regression: the endpoint lived inside the first Cucumber worker and closed
  // when that worker finished, while slower workers still needed it.
  it('is served by its own process, not by the worker that started it', async () => {
    const health = await (await fetch(`${LLM_MOCK_URL}/__e2e/health`)).json();

    expect(health.ok).toBe(true);
    expect(health.pid).not.toBe(process.pid);
  });

  it('keeps a reply another worker still holds when one worker clears it', async () => {
    const shared = reply('shared prompt', 'exact', 'shared reply');
    await registerLLMReplies({ replies: [shared] });
    await fetch(`${LLM_MOCK_URL}/__e2e/llm/replies`, {
      body: JSON.stringify({ owner: 'other-worker', replies: [shared] }),
      method: 'POST',
    });

    await registerLLMReplies({ clear: ['exact:shared prompt'] });
    expect(await complete('shared prompt')).toBe('shared reply');

    await fetch(`${LLM_MOCK_URL}/__e2e/llm/replies`, {
      body: JSON.stringify({ clear: ['exact:shared prompt'], owner: 'other-worker' }),
      method: 'POST',
    });
    expect(await complete('shared prompt')).not.toBe('shared reply');
  });

  it('answers a server-side chat completion with the registered reply', async () => {
    await registerLLMReplies({
      replies: [
        reply('hello server', 'exact', 'registered reply'),
        reply('fragment', 'contains', 'fragment reply'),
      ],
    });

    // Message content arrives as typed parts from the server runtime.
    expect(await complete([{ text: 'Hello Server', type: 'text' }])).toBe('registered reply');
    expect(await complete('with a fragment inside')).toBe('fragment reply');

    const res = await fetch(`${LLM_MOCK_URL}/v1/chat/completions`, {
      body: JSON.stringify({
        messages: [{ content: 'hello server', role: 'user' }],
        model: 'deepseek-v4-flash',
        stream: true,
      }),
      method: 'POST',
    });
    const text = await res.text();

    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(parseContent(text)).toBe('registered reply');
    expect(text.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  // Regression: after the first start the worker cached the resolved start and
  // never checked again, so once the process exited (idle timeout) every later
  // registration went to a dead port.
  it('starts the process again after it exits', async () => {
    await fetch(`${LLM_MOCK_URL}/__e2e/shutdown`, { method: 'POST' });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const up = await fetch(`${LLM_MOCK_URL}/__e2e/health`).then(
        (res) => res.ok,
        () => false,
      );
      if (!up) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await registerLLMReplies({ replies: [reply('after restart', 'exact', 'restarted reply')] });

    expect(await complete('after restart')).toBe('restarted reply');
    await registerLLMReplies({ clear: ['exact:after restart'] });
  });
});
