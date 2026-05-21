// @vitest-environment node
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeDeepSeekAnthropicAI } from '../index';
import {
  expectNoLoneSurrogateEscapes,
  loneHighSurrogate,
  loneLowSurrogate,
  validEmoji,
} from './testUtils';

describe('LobeDeepSeekAnthropicAI handlePayload', () => {
  let instance: InstanceType<typeof LobeDeepSeekAnthropicAI>;

  const getLastRequestPayload = () => {
    const calls = ((instance as any).client.messages.create as Mock).mock.calls;
    return calls.at(-1)?.[0];
  };

  beforeEach(() => {
    instance = new LobeDeepSeekAnthropicAI({ apiKey: 'test' });

    vi.spyOn((instance as any).client.messages, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should enable thinking by default for deepseek-v4-pro', async () => {
    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'deepseek-v4-pro',
      temperature: 0,
    });

    const payload = getLastRequestPayload();

    expect(payload.max_tokens).toBe(393_216);
    expect(payload.thinking).toEqual({
      budget_tokens: 1024,
      type: 'enabled',
    });
  });

  it('should disable thinking when thinking.type is disabled', async () => {
    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'deepseek-v4-flash',
      reasoning_effort: 'high',
      thinking: { budget_tokens: 0, type: 'disabled' },
    });

    const payload = getLastRequestPayload();

    expect(payload.thinking).toEqual({ type: 'disabled' });
    expect(payload.output_config).toBeUndefined();
  });

  it('should map reasoning_effort to output_config.effort when thinking is enabled', async () => {
    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'deepseek-v4-flash',
      reasoning_effort: 'high',
      thinking: { budget_tokens: 2048, type: 'enabled' },
    });

    const payload = getLastRequestPayload();

    expect(payload.output_config).toEqual({ effort: 'high' });
    expect(payload.thinking).toEqual({
      budget_tokens: 2048,
      type: 'enabled',
    });
  });

  it('should not add thinking params for deepseek-chat by default', async () => {
    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'deepseek-chat',
    });

    const payload = getLastRequestPayload();

    expect(payload.thinking).toBeUndefined();
    expect(payload.output_config).toBeUndefined();
  });

  it('should preserve DeepSeek temperature scale for non-thinking Anthropic requests', async () => {
    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'deepseek-chat',
      temperature: 1.4,
    });

    const payload = getLastRequestPayload();

    expect(payload.temperature).toBe(1.4);
  });

  it('should convert assistant reasoning to Anthropic thinking block', async () => {
    await instance.chat({
      messages: [
        { content: 'Hello', role: 'user' },
        {
          content: 'Response',
          reasoning: { content: 'My reasoning process' },
          role: 'assistant',
        } as any,
        { content: 'Follow-up', role: 'user' },
      ],
      model: 'deepseek-v4-flash',
    });

    const payload = getLastRequestPayload();
    const assistantMessage = payload.messages.find((message: any) => message.role === 'assistant');

    expect(assistantMessage?.content).toEqual([
      { thinking: 'My reasoning process', type: 'thinking' },
      { text: 'Response', type: 'text' },
    ]);
  });

  it('should convert tool calls to Anthropic tool_use with a thinking placeholder', async () => {
    await instance.chat({
      messages: [
        { content: 'Search weather', role: 'user' },
        {
          content: '',
          role: 'assistant',
          tool_calls: [
            {
              function: { arguments: '{"city":"Beijing"}', name: 'get_weather' },
              id: 'call_1',
              type: 'function',
            },
          ],
        } as any,
        {
          content: '{"temp":20}',
          role: 'tool',
          tool_call_id: 'call_1',
        } as any,
      ],
      model: 'deepseek-v4-flash',
    });

    const payload = getLastRequestPayload();
    const assistantMessage = payload.messages.find((message: any) => message.role === 'assistant');

    expect(assistantMessage?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ thinking: ' ', type: 'thinking' }),
        expect.objectContaining({ name: 'get_weather', type: 'tool_use' }),
      ]),
    );
  });

  it('should remove lone surrogates from converted Anthropic tool_use input', async () => {
    await instance.chat({
      messages: [
        { content: 'Search weather', role: 'user' },
        {
          content: '',
          role: 'assistant',
          tool_calls: [
            {
              function: {
                arguments: `{"city":"${loneHighSurrogate} ${validEmoji}","nested":{"value":"${loneLowSurrogate}"}}`,
                name: 'get_weather',
              },
              id: 'call_1',
              type: 'function',
            },
          ],
        } as any,
        {
          content: '{"temp":20}',
          role: 'tool',
          tool_call_id: 'call_1',
        } as any,
      ],
      model: 'deepseek-v4-flash',
    });

    const payload = getLastRequestPayload();
    const serialized = expectNoLoneSurrogateEscapes(payload);
    const assistantMessage = payload.messages.find((message: any) => message.role === 'assistant');
    const toolUseBlock = assistantMessage?.content.find((block: any) => block.type === 'tool_use');

    expect(serialized).toContain(validEmoji);
    expect(toolUseBlock?.input).toEqual({
      city: ` ${validEmoji}`,
      nested: { value: '' },
    });
  });

  it('should remove lone surrogates from Anthropic chat payload strings', async () => {
    await instance.chat({
      messages: [
        { content: `Hello ${loneHighSurrogate} ${validEmoji}`, role: 'user' },
        {
          content: 'Response',
          reasoning: { content: `Reasoning ${loneLowSurrogate} value` },
          role: 'assistant',
        } as any,
      ],
      model: 'deepseek-v4-flash',
    });

    const payload = getLastRequestPayload();
    const serialized = expectNoLoneSurrogateEscapes(payload);

    expect(serialized).toContain(validEmoji);
  });
});
