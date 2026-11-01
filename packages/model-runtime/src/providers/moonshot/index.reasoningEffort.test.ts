// @vitest-environment node
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeMoonshotAnthropicAI } from './index';

const { loadModelsMock } = vi.hoisted(() => ({
  loadModelsMock: vi.fn(),
}));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: loadModelsMock,
}));

describe('LobeMoonshotAnthropicAI reasoning effort', () => {
  let instance: InstanceType<typeof LobeMoonshotAnthropicAI>;

  const getLastRequestPayload = () => {
    const calls = ((instance as any).client.messages.create as Mock).mock.calls;
    return calls.at(-1)?.[0];
  };

  beforeEach(() => {
    loadModelsMock.mockResolvedValue([]);
    instance = new LobeMoonshotAnthropicAI({ apiKey: 'test' });

    vi.spyOn((instance as any).client.messages, 'create').mockResolvedValue(
      new ReadableStream() as any,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(['kimi-k3', 'kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed'])(
    'should send reasoning_effort as output_config.effort for %s',
    async (model) => {
      await instance.chat({
        messages: [{ content: 'Hello', role: 'user' }],
        model,
        reasoning_effort: 'low',
        temperature: 1,
      });

      const payload = getLastRequestPayload();
      expect(payload.output_config).toEqual({ effort: 'low' });
      expect(payload.reasoning_effort).toBeUndefined();
    },
  );

  it.each(['low', 'high', 'max'])('should forward %s reasoning effort', async (effort) => {
    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'kimi-k3.1-pro',
      reasoning_effort: effort as 'low' | 'high' | 'max',
      temperature: 1,
    });

    expect(getLastRequestPayload().output_config).toEqual({ effort });
  });

  it('should drop reasoning effort values that Kimi does not accept', async () => {
    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'kimi-k3.1-pro',
      reasoning_effort: 'medium',
      temperature: 1,
    });

    const payload = getLastRequestPayload();
    expect(payload.output_config).toBeUndefined();
  });

  it('should not send output_config when no reasoning effort is set', async () => {
    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'kimi-k3.1-pro',
      temperature: 1,
    });

    expect(getLastRequestPayload().output_config).toBeUndefined();
  });

  it('should not send output_config for K2.x models', async () => {
    await instance.chat({
      messages: [{ content: 'Hello', role: 'user' }],
      model: 'kimi-k2.7-code',
      reasoning_effort: 'high',
      temperature: 1,
    });

    expect(getLastRequestPayload().output_config).toBeUndefined();
  });
});
