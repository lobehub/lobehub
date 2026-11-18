// @vitest-environment node
import { InvokeModelWithResponseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeBedrockAI } from './index';

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

vi.mock('@aws-sdk/client-bedrock-runtime', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  InvokeModelWithResponseStreamCommand: vi.fn(),
}));

let instance: LobeBedrockAI;

beforeEach(() => {
  instance = new LobeBedrockAI({
    accessKeyId: 'test-access-key-id',
    accessKeySecret: 'test-access-key-secret',
    region: 'us-west-2',
  });
  vi.spyOn(instance['client'], 'send');
});

afterEach(() => vi.clearAllMocks());

describe('Bedrock Claude cache TTL', () => {
  it('should stamp contextCachingTTL on every cache breakpoint', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    (instance['client'].send as Mock).mockResolvedValue(Promise.resolve(mockStream));

    await instance.chat({
      contextCachingTTL: '1h',
      messages: [
        { content: 'You are an awesome greeter', role: 'system' },
        { content: 'Hello', role: 'user' },
      ],
      model: 'global.anthropic.claude-sonnet-4-6',
      tools: [{ function: { name: 'lookup', parameters: {} }, type: 'function' }],
    });

    const commandInput = (InvokeModelWithResponseStreamCommand as unknown as Mock).mock.calls[0][0];
    const body = JSON.parse(commandInput.body);
    const cacheControl = { ttl: '1h', type: 'ephemeral' };

    expect(body.system[0].cache_control).toEqual(cacheControl);
    expect(body.messages.at(-1).content.at(-1).cache_control).toEqual(cacheControl);
    expect(body.tools.at(-1).cache_control).toEqual(cacheControl);
  });

  it('should not send a cache breakpoint when context caching is disabled, even with a ttl', async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    (instance['client'].send as Mock).mockResolvedValue(Promise.resolve(mockStream));

    await instance.chat({
      contextCachingTTL: '1h',
      enabledContextCaching: false,
      messages: [
        { content: 'You are an awesome greeter', role: 'system' },
        { content: 'Hello', role: 'user' },
      ],
      model: 'global.anthropic.claude-sonnet-4-6',
      tools: [{ function: { name: 'lookup', parameters: {} }, type: 'function' }],
    });

    const commandInput = (InvokeModelWithResponseStreamCommand as unknown as Mock).mock.calls[0][0];
    const body = JSON.parse(commandInput.body);

    expect(body.system[0].cache_control).toBeUndefined();
    expect(JSON.stringify(body.messages)).not.toContain('cache_control');
    expect(body.tools.at(-1).cache_control).toBeUndefined();
  });
});
