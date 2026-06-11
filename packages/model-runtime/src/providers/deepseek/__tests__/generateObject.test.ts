// @vitest-environment node
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeDeepSeekAnthropicAI, openAIParams } from '../index';
import { expectNoLoneSurrogateEscapes, loneHighSurrogate, validEmoji } from './testUtils';

describe('LobeDeepSeekAnthropicAI generateObject', () => {
  let instance: InstanceType<typeof LobeDeepSeekAnthropicAI>;

  const generateObjectPayload = {
    messages: [{ content: 'Generate a handoff', role: 'user' as const }],
    model: 'deepseek-v4-pro',
    schema: {
      name: 'task_topic_handoff',
      schema: {
        additionalProperties: false,
        properties: { summary: { type: 'string' }, title: { type: 'string' } },
        required: ['title', 'summary'],
        type: 'object' as const,
      },
    },
  };

  const getLastRequestPayload = () => {
    const calls = ((instance as any).client.messages.create as Mock).mock.calls;
    return calls.at(-1)?.[0];
  };

  beforeEach(() => {
    instance = new LobeDeepSeekAnthropicAI({ apiKey: 'test' });

    vi.spyOn((instance as any).client.messages, 'create').mockResolvedValue({
      content: [
        {
          id: 'call_1',
          input: { summary: 'Task completed', title: 'Done' },
          name: 'task_topic_handoff',
          type: 'tool_use',
        },
      ],
      usage: {
        input_tokens: 3,
        output_tokens: 4,
      },
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should use any tool choice by default for server-side thinking', async () => {
    // DeepSeek's Anthropic-compatible endpoint rejects named tool_choice while
    // thinking is active, but accepts `any`; V4 models can default to thinking
    // enabled server-side.
    const result = await instance.generateObject(generateObjectPayload);

    const payload = getLastRequestPayload();

    expect(payload.thinking).toBeUndefined();
    expect(payload.tool_choice).toEqual({ type: 'any' });
    expect(payload.tools).toEqual([
      expect.objectContaining({
        input_schema: expect.objectContaining({
          additionalProperties: false,
          required: ['title', 'summary'],
          type: 'object',
        }),
        name: 'task_topic_handoff',
      }),
    ]);
    expect(result).toEqual({ summary: 'Task completed', title: 'Done' });
  });

  it('should keep named tool choice when thinking is disabled', async () => {
    await instance.generateObject({
      ...generateObjectPayload,
      thinking: { type: 'disabled' },
    } as any);

    const payload = getLastRequestPayload();

    expect(payload.thinking).toEqual({ type: 'disabled' });
    expect(payload.tool_choice).toEqual({ name: 'task_topic_handoff', type: 'tool' });
  });

  it('should use any tool choice when thinking is explicitly enabled', async () => {
    await instance.generateObject({
      ...generateObjectPayload,
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any);

    const payload = getLastRequestPayload();

    expect(payload.thinking).toBeUndefined();
    expect(payload.tool_choice).toEqual({ type: 'any' });
  });

  it('should use any tool choice for thinking-only deepseek-reasoner', async () => {
    await instance.generateObject({
      ...generateObjectPayload,
      model: 'deepseek-reasoner',
    });

    const payload = getLastRequestPayload();

    expect(payload.thinking).toBeUndefined();
    expect(payload.tool_choice).toEqual({ type: 'any' });
  });

  it('should map reasoning_effort to output_config.effort when thinking is enabled', async () => {
    await instance.generateObject({
      ...generateObjectPayload,
      reasoning_effort: 'high',
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any);

    const payload = getLastRequestPayload();

    expect(payload.output_config).toEqual({ effort: 'high' });
    expect(payload.tool_choice).toEqual({ type: 'any' });
  });

  it('should remove lone surrogates from Anthropic generateObject request payload strings', async () => {
    await instance.generateObject({
      ...generateObjectPayload,
      messages: [
        {
          content: `Generate ${loneHighSurrogate} handoff ${validEmoji}`,
          role: 'user' as const,
        },
      ],
    });

    const payload = getLastRequestPayload();
    const serialized = expectNoLoneSurrogateEscapes(payload);

    expect(serialized).toContain(validEmoji);
  });

  it('should omit output_config when thinking is disabled', async () => {
    await instance.generateObject({
      ...generateObjectPayload,
      reasoning_effort: 'high',
      thinking: { budget_tokens: 0, type: 'disabled' },
    });

    const payload = getLastRequestPayload();

    expect(payload.output_config).toBeUndefined();
    expect(payload.thinking).toEqual({ type: 'disabled' });
  });
});

describe('DeepSeek OpenAI-compatible generateObject configuration', () => {
  it('should use tools calling for generateObject', () => {
    expect(openAIParams.generateObject).toBeDefined();
    expect(openAIParams.generateObject?.useToolsCalling).toBe(true);
  });

  it('should disable thinking by default for V4 generateObject requests', () => {
    // V4 defaults to thinking enabled server-side, which rejects the forced
    // tool_choice used for structured output.
    const requestPayload = {
      messages: [{ role: 'user' as const, content: 'Hello' }],
      model: 'deepseek-v4-flash',
      reasoning_effort: 'high' as const,
    };

    const result = openAIParams.generateObject!.handlePayload!(
      {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'deepseek-v4-flash',
      },
      requestPayload,
      {},
    );

    expect(result).toEqual(expect.objectContaining({ thinking: { type: 'disabled' } }));
    expect(result).not.toHaveProperty('reasoning_effort');
  });

  it('should disable thinking for provider-prefixed V4 generateObject requests', () => {
    const requestPayload = {
      messages: [{ role: 'user' as const, content: 'Hello' }],
      model: 'Deepseek/deepseek-v4-pro',
      reasoning_effort: 'high' as const,
    };

    const result = openAIParams.generateObject!.handlePayload!(
      {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'Deepseek/deepseek-v4-pro',
      },
      requestPayload,
      {},
    );

    expect(result).toEqual(expect.objectContaining({ thinking: { type: 'disabled' } }));
    expect(result).not.toHaveProperty('reasoning_effort');
  });

  it('should not inject thinking parameter for thinking-only deepseek-reasoner', () => {
    const requestPayload = {
      messages: [{ role: 'user' as const, content: 'Hello' }],
      model: 'deepseek-reasoner',
    };

    const result = openAIParams.generateObject!.handlePayload!(
      {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'deepseek-reasoner',
      },
      requestPayload,
      {},
    );

    expect(result).not.toHaveProperty('thinking');
  });

  it('should forward disabled thinking for generateObject DeepSeek requests', () => {
    const requestPayload = {
      messages: [{ role: 'user' as const, content: 'Hello' }],
      model: 'deepseek-v4-pro',
      reasoning_effort: 'high' as const,
    };

    const result = openAIParams.generateObject!.handlePayload!(
      {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'deepseek-v4-pro',
        thinking: { budget_tokens: 0, type: 'disabled' },
      },
      requestPayload,
      {},
    );

    expect(result).toEqual(expect.objectContaining({ thinking: { type: 'disabled' } }));
    expect(result).not.toHaveProperty('reasoning_effort');
  });

  it('should preserve reasoning_effort when generateObject thinking is enabled', () => {
    const requestPayload = {
      messages: [{ role: 'user' as const, content: 'Hello' }],
      model: 'deepseek-v4-pro',
      reasoning_effort: 'high' as const,
    };

    const result = openAIParams.generateObject!.handlePayload!(
      {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'deepseek-v4-pro',
        thinking: { budget_tokens: 1024, type: 'enabled' },
      },
      requestPayload,
      {},
    );

    expect(result.reasoning_effort).toBe('high');
    expect(result).toEqual(expect.objectContaining({ thinking: { type: 'enabled' } }));
  });

  it('should remove lone surrogates from generateObject request payload strings', () => {
    const requestPayload = {
      messages: [{ role: 'user' as const, content: `Hello ${loneHighSurrogate} ${validEmoji}` }],
      model: 'deepseek-v4-pro',
      reasoning_effort: 'high' as const,
    };

    const result = openAIParams.generateObject!.handlePayload!(
      {
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'deepseek-v4-pro',
        thinking: { budget_tokens: 1024, type: 'enabled' },
      },
      requestPayload,
      {},
    );
    const serialized = expectNoLoneSurrogateEscapes(result);

    expect(serialized).toContain(validEmoji);
  });
});
