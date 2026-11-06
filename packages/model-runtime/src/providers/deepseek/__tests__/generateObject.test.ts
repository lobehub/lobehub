// @vitest-environment node
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeepSeekAnthropicGenerateObject } from '../generateObject';
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

  it('should disable thinking and force the schema tool by default for V4 models', async () => {
    // Regression: since 2026-11-02 DeepSeek's Anthropic-compatible endpoint
    // rejects `tool_choice: any` while V4's server-side default thinking is
    // active ("Thinking mode does not support this tool_choice").
    const result = await instance.generateObject(generateObjectPayload);

    const payload = getLastRequestPayload();

    expect(payload.thinking).toEqual({ type: 'disabled' });
    expect(payload.tool_choice).toEqual({ name: 'task_topic_handoff', type: 'tool' });
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

  it('should disable thinking when only the mapped request model is V4', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ input: { title: 'Done' }, name: 'task_topic_handoff', type: 'tool_use' }],
    });

    await createDeepSeekAnthropicGenerateObject(
      { messages: { create } } as any,
      { ...generateObjectPayload, model: 'custom-flash' },
      undefined,
      undefined,
      { requestModel: 'deepseek-v4-flash' },
    );

    const payload = create.mock.calls[0][0];

    expect(payload.model).toBe('deepseek-v4-flash');
    expect(payload.thinking).toEqual({ type: 'disabled' });
    expect(payload.tool_choice).toEqual({ name: 'task_topic_handoff', type: 'tool' });
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

  it('should use auto tool choice with a prompt instruction when thinking is explicitly enabled', async () => {
    await instance.generateObject({
      ...generateObjectPayload,
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any);

    const payload = getLastRequestPayload();

    expect(payload.thinking).toBeUndefined();
    expect(payload.tool_choice).toEqual({ type: 'auto' });
    expect(payload.system?.[0]?.text).toContain('`task_topic_handoff` tool');
  });

  it('should use auto tool choice for thinking-only deepseek-reasoner', async () => {
    await instance.generateObject({
      ...generateObjectPayload,
      model: 'deepseek-reasoner',
    });

    const payload = getLastRequestPayload();

    expect(payload.thinking).toBeUndefined();
    expect(payload.tool_choice).toEqual({ type: 'auto' });
  });

  it('should force the schema tool without a thinking parameter for non-thinking deepseek-chat', async () => {
    await instance.generateObject({
      ...generateObjectPayload,
      model: 'deepseek-chat',
    });

    const payload = getLastRequestPayload();

    expect(payload.thinking).toBeUndefined();
    expect(payload.tool_choice).toEqual({ name: 'task_topic_handoff', type: 'tool' });
  });

  it('should use auto tool choice with a prompt instruction for V4 tools-mode requests', async () => {
    const tools = [
      {
        function: {
          description: 'Pick a title',
          name: 'pick_title',
          parameters: { properties: { title: { type: 'string' } }, type: 'object' as const },
        },
        type: 'function' as const,
      },
    ];

    await instance.generateObject({ ...generateObjectPayload, schema: undefined, tools } as any);
    let payload = getLastRequestPayload();

    // DeepSeek treats `any` as `auto`, so tools mode relies on the instruction.
    expect(payload.thinking).toEqual({ type: 'disabled' });
    expect(payload.tool_choice).toEqual({ type: 'auto' });
    expect(payload.system?.[0]?.text).toContain('calling one of the provided tools');

    await instance.generateObject({
      ...generateObjectPayload,
      schema: undefined,
      thinking: { budget_tokens: 1024, type: 'enabled' },
      tools,
    } as any);
    payload = getLastRequestPayload();

    expect(payload.thinking).toBeUndefined();
    expect(payload.tool_choice).toEqual({ type: 'auto' });
  });

  it('should map reasoning_effort to output_config.effort when thinking is enabled', async () => {
    await instance.generateObject({
      ...generateObjectPayload,
      reasoning_effort: 'high',
      thinking: { budget_tokens: 1024, type: 'enabled' },
    } as any);

    const payload = getLastRequestPayload();

    expect(payload.output_config).toEqual({ effort: 'high' });
    expect(payload.tool_choice).toEqual({ type: 'auto' });
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
