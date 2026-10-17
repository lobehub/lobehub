// @vitest-environment node
import { Ollama } from 'ollama/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StructuredOutputError } from '../../core/openaiCompatibleFactory/structuredOutput';
import { AgentRuntimeErrorType } from '../../types/error';
import { LobeOllamaAI } from './index';

vi.mock('ollama/browser');

const schema = {
  name: 'topic_title',
  schema: {
    properties: { title: { type: 'string' } },
    required: ['title'],
    type: 'object' as const,
  },
};

describe('LobeOllamaAI.generateObject', () => {
  let ollamaAI: LobeOllamaAI;

  beforeEach(() => {
    ollamaAI = new LobeOllamaAI({ baseURL: 'http://localhost:11434' });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('constrains the reply with the JSON schema as Ollama `format` and parses it', async () => {
    vi.mocked(Ollama.prototype.chat).mockResolvedValue({
      eval_count: 12,
      message: { content: '{"title":"Sourdough basics"}', role: 'assistant' },
      prompt_eval_count: 30,
    } as any);
    const onUsage = vi.fn();

    const result = await ollamaAI.generateObject(
      { messages: [{ content: 'Name this chat', role: 'user' }], model: 'qwen3:1.7b', schema },
      { onUsage },
    );

    expect(result).toEqual({ title: 'Sourdough basics' });
    expect(Ollama.prototype.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        format: schema.schema,
        messages: [{ content: 'Name this chat', role: 'user' }],
        model: 'qwen3:1.7b',
        stream: false,
      }),
    );
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputTextTokens: 30, outputTextTokens: 12, totalTokens: 42 }),
    );
  });

  it('turns thinking off only when the caller disables it', async () => {
    vi.mocked(Ollama.prototype.chat).mockResolvedValue({
      message: { content: '{"title":"x"}', role: 'assistant' },
    } as any);

    await ollamaAI.generateObject({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'qwen3:1.7b',
      schema,
      thinking: { budget_tokens: 0, type: 'disabled' },
    });
    expect(vi.mocked(Ollama.prototype.chat).mock.calls[0][0]).toMatchObject({ think: false });

    await ollamaAI.generateObject({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'llama3.2:3b',
      schema,
    });
    expect(vi.mocked(Ollama.prototype.chat).mock.calls[1][0]).not.toHaveProperty('think');
  });

  it('returns tool calls in the `{ arguments, name }[]` shape for tools-based calls', async () => {
    vi.mocked(Ollama.prototype.chat).mockResolvedValue({
      message: {
        content: '',
        role: 'assistant',
        tool_calls: [{ function: { arguments: { items: ['a', 'b'] }, name: 'suggest' } }],
      },
    } as any);
    const tools = [
      {
        function: {
          name: 'suggest',
          parameters: { properties: { items: { type: 'array' } }, type: 'object' },
        },
        type: 'function' as const,
      },
    ];

    const result = await ollamaAI.generateObject({
      messages: [{ content: 'follow ups?', role: 'user' }],
      model: 'llama3.2:3b',
      tools,
    });

    expect(result).toEqual([{ arguments: { items: ['a', 'b'] }, name: 'suggest' }]);
    expect(Ollama.prototype.chat).toHaveBeenCalledWith(
      expect.objectContaining({ stream: false, tools }),
    );
  });

  it('rejects a reply that is not valid JSON with a StructuredOutputError', async () => {
    vi.mocked(Ollama.prototype.chat).mockResolvedValue({
      message: { content: 'Sure! Here is a title', role: 'assistant' },
    } as any);

    await expect(
      ollamaAI.generateObject({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'qwen3:1.7b',
        schema,
      }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
  });

  it('rejects a tools call that returns no tool calls', async () => {
    vi.mocked(Ollama.prototype.chat).mockResolvedValue({
      message: { content: 'no tools', role: 'assistant' },
    } as any);

    await expect(
      ollamaAI.generateObject({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'llama3.2:3b',
        tools: [{ function: { name: 'suggest', parameters: {} }, type: 'function' }],
      }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
  });

  it('maps Ollama failures to an OllamaBizError', async () => {
    vi.mocked(Ollama.prototype.chat).mockRejectedValue({
      error: 'model "nope" not found',
      name: 'ResponseError',
      status_code: 404,
    });

    await expect(
      ollamaAI.generateObject({
        messages: [{ content: 'hi', role: 'user' }],
        model: 'nope',
        schema,
      }),
    ).rejects.toMatchObject({ errorType: AgentRuntimeErrorType.OllamaBizError });
  });

  // Regression: a non-streamed Ollama call is out of `client.abort()`'s reach, so a
  // cancelled relayed structured call used to keep Ollama generating until it finished.
  it('sends the request with the caller abort signal', async () => {
    vi.mocked(Ollama.prototype.chat).mockResolvedValue({
      message: { content: '{"title":"x"}', role: 'assistant' },
    } as any);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const controller = new AbortController();

    await ollamaAI.generateObject(
      { messages: [{ content: 'hi', role: 'user' }], model: 'qwen3:1.7b', schema },
      { signal: controller.signal },
    );

    const config = vi.mocked(Ollama).mock.calls.at(-1)?.[0];
    expect(config).toMatchObject({ host: 'http://localhost:11434' });
    await config?.fetch?.('http://localhost:11434/api/chat', { method: 'POST' });
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({ method: 'POST', signal: controller.signal }),
    );
    fetchSpy.mockRestore();
  });

  it('requires a schema or tools', async () => {
    await expect(
      ollamaAI.generateObject({ messages: [{ content: 'hi', role: 'user' }], model: 'x' }),
    ).rejects.toThrow('tools or schema is required');
  });
});
