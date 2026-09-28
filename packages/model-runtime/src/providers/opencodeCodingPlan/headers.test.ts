// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeOpenCodeCodingPlanAI } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

describe('OpenCode Go session headers', () => {
  const requests: { headers: Headers; url: string }[] = [];
  const messages = [{ content: 'Hello', role: 'user' as const }];
  const createRuntime = () => new LobeOpenCodeCodingPlanAI({ apiKey: 'test' });

  beforeEach(() => {
    requests.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url) === 'https://models.dev/api.json') {
          return Response.json({
            'opencode-go': {
              models: {
                'qwen-test': { id: 'qwen-test', provider: { npm: '@ai-sdk/anthropic' } },
              },
            },
          });
        }

        requests.push({ headers: new Headers(init?.headers), url: String(url) });
        return Response.json({
          id: 'test-response',
          choices: [
            {
              finish_reason: 'stop',
              index: 0,
              message: {
                content: '{"ok":true}',
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'tool-1',
                    type: 'function',
                    function: { name: 'result', arguments: '{"ok":true}' },
                  },
                ],
              },
            },
          ],
          content: [{ id: 'tool-1', type: 'tool_use', name: 'result', input: { ok: true } }],
          model: 'test',
          role: 'assistant',
          stop_reason: 'end_turn',
          type: 'message',
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['glm-5', '/chat/completions'],
    ['deepseek-v4-pro', '/chat/completions'],
    ['qwen-test', '/messages'],
  ])('preserves conversation affinity across runtime instances for %s', async (model, endpoint) => {
    for (const topicId of ['topic-a', 'topic-a', 'topic-b']) {
      const response = await createRuntime().chat(
        { messages, model, stream: false },
        {
          metadata: { topicId },
          requestHeaders: { 'x-custom': 'preserved' },
        },
      );
      await response.text();
    }

    expect(requests).toHaveLength(3);
    expect(requests.map(({ headers }) => headers.get('x-opencode-session'))).toEqual([
      'topic-a',
      'topic-a',
      'topic-b',
    ]);
    for (const { headers, url } of requests) {
      expect(url).toBe(`https://opencode.ai/zen/go/v1${endpoint}`);
      expect(headers.get('x-opencode-client')).toBe('lobehub');
      expect(headers.get('user-agent')).toBe('lobehub');
      expect(headers.get('x-custom')).toBe('preserved');
    }
  });

  it.each(['glm-5', 'deepseek-v4-pro', 'qwen-test'])(
    'sends session headers for %s structured output',
    async (model) => {
      const result = await createRuntime().generateObject(
        {
          messages,
          model,
          schema: {
            name: 'result',
            schema: { properties: { ok: { type: 'boolean' } }, type: 'object' },
          },
        },
        { metadata: { topicId: 'topic-object' } },
      );

      expect(result).toEqual({ ok: true });
      expect(requests).toHaveLength(1);
      expect(requests[0].headers.get('x-opencode-session')).toBe('topic-object');
      expect(requests[0].headers.get('x-opencode-client')).toBe('lobehub');
    },
  );

  it('reuses a topicless task ID across chat and structured output', async () => {
    for (const taskId of ['task-1', 'task-1', 'task-2']) {
      const runtime = createRuntime();
      const response = await runtime.chat(
        { messages, model: 'glm-5', stream: false },
        { metadata: { taskId } },
      );
      await response.text();
      await runtime.generateObject(
        {
          messages,
          model: 'glm-5',
          schema: {
            name: 'result',
            schema: { properties: { ok: { type: 'boolean' } }, type: 'object' },
          },
        },
        { metadata: { taskId } },
      );
    }

    expect(requests.map(({ headers }) => headers.get('x-opencode-session'))).toEqual([
      'task-1',
      'task-1',
      'task-1',
      'task-1',
      'task-2',
      'task-2',
    ]);
  });

  it('prefers the topic over a task ID', async () => {
    const response = await createRuntime().chat(
      { messages, model: 'glm-5', stream: false },
      { metadata: { taskId: 'task-1', topicId: 'topic-1' } },
    );
    await response.text();

    expect(requests[0].headers.get('x-opencode-session')).toBe('topic-1');
  });

  it('assigns separate UUIDs to standalone requests without a topic or task', async () => {
    const runtime = createRuntime();
    for (let i = 0; i < 2; i++) {
      const response = await runtime.chat({ messages, model: 'glm-5', stream: false });
      await response.text();
    }
    const ids = requests.map(({ headers }) => headers.get('x-opencode-session'));
    for (const id of ids)
      expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
