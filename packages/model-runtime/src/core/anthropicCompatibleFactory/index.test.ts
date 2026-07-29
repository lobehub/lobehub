// @vitest-environment node
import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createAnthropicCompatibleRuntime,
  createDefaultAnthropicClient,
  DEFAULT_ANTHROPIC_TIMEOUT,
} from './index';

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn();
  return { default: MockAnthropic };
});

vi.mock('@lobechat/const', () => ({
  CURRENT_VERSION: '1.0.0-test',
}));

vi.mock('@lobechat/business-model-bank/model-config', () => ({
  loadModels: vi.fn().mockResolvedValue([]),
}));

const MockedAnthropic = vi.mocked(Anthropic);
const originalAnthropicClientTimeout = process.env.ANTHROPIC_CLIENT_TIMEOUT;

afterEach(() => {
  if (originalAnthropicClientTimeout === undefined) {
    delete process.env.ANTHROPIC_CLIENT_TIMEOUT;
  } else {
    process.env.ANTHROPIC_CLIENT_TIMEOUT = originalAnthropicClientTimeout;
  }
});

describe('createDefaultAnthropicClient', () => {
  it('should include User-Agent header with current version', () => {
    MockedAnthropic.mockClear();

    createDefaultAnthropicClient({ apiKey: 'test-key' });

    expect(MockedAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultHeaders: expect.objectContaining({
          'User-Agent': 'lobehub/1.0.0-test',
        }),
      }),
    );
  });

  it('should preserve caller-provided default headers alongside User-Agent', () => {
    MockedAnthropic.mockClear();

    createDefaultAnthropicClient({
      apiKey: 'test-key',
      defaultHeaders: { 'X-Custom': 'value' },
    });

    const passedOptions = MockedAnthropic.mock.calls[0][0] as any;

    expect(passedOptions.defaultHeaders).toMatchObject({
      'User-Agent': 'lobehub/1.0.0-test',
      'X-Custom': 'value',
    });
  });

  it('should set the default Anthropic timeout explicitly', () => {
    MockedAnthropic.mockClear();
    delete process.env.ANTHROPIC_CLIENT_TIMEOUT;

    createDefaultAnthropicClient({ apiKey: 'test-key' });

    expect(MockedAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: DEFAULT_ANTHROPIC_TIMEOUT,
      }),
    );
  });

  it('should use ANTHROPIC_CLIENT_TIMEOUT as the default timeout when configured', () => {
    MockedAnthropic.mockClear();
    process.env.ANTHROPIC_CLIENT_TIMEOUT = '780000';

    createDefaultAnthropicClient({ apiKey: 'test-key' });

    expect(MockedAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 780_000,
      }),
    );

    delete process.env.ANTHROPIC_CLIENT_TIMEOUT;
  });

  it('should ignore invalid ANTHROPIC_CLIENT_TIMEOUT values', () => {
    MockedAnthropic.mockClear();
    process.env.ANTHROPIC_CLIENT_TIMEOUT = 'invalid';

    createDefaultAnthropicClient({ apiKey: 'test-key' });

    expect(MockedAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: DEFAULT_ANTHROPIC_TIMEOUT,
      }),
    );

    delete process.env.ANTHROPIC_CLIENT_TIMEOUT;
  });

  it('should preserve caller-provided timeout', () => {
    MockedAnthropic.mockClear();
    process.env.ANTHROPIC_CLIENT_TIMEOUT = '780000';

    createDefaultAnthropicClient({
      apiKey: 'test-key',
      timeout: 3_600_000,
    });

    expect(MockedAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 3_600_000,
      }),
    );

    delete process.env.ANTHROPIC_CLIENT_TIMEOUT;
  });

  it.each([
    ['https://aihubmix.com/v1', 'https://aihubmix.com'],
    ['https://aihubmix.com/v1/messages', 'https://aihubmix.com'],
    ['https://api.example.com/anthropic/v1', 'https://api.example.com/anthropic'],
    ['https://api.example.com/anthropic', 'https://api.example.com/anthropic'],
  ])('should normalize Anthropic SDK-managed baseURL path %s', (baseURL, expectedBaseURL) => {
    MockedAnthropic.mockClear();

    createDefaultAnthropicClient({ apiKey: 'test-key', baseURL });

    expect(MockedAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: expectedBaseURL,
      }),
    );
  });
});

describe('createAnthropicCompatibleRuntime', () => {
  it('should normalize default baseURL before creating a custom client', () => {
    const createClient = vi.fn((options) => ({ baseURL: options.baseURL }) as unknown as Anthropic);
    const Runtime = createAnthropicCompatibleRuntime({
      baseURL: 'https://aihubmix.com/v1',
      customClient: { createClient },
      provider: 'test-provider',
    });

    const runtime = new Runtime({ apiKey: 'test-key' });

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://aihubmix.com',
        timeout: DEFAULT_ANTHROPIC_TIMEOUT,
      }),
    );
    expect(runtime.baseURL).toBe('https://aihubmix.com');
  });

  it('should send mapped model id to Anthropic Messages API', async () => {
    const messagesCreate = vi.fn().mockResolvedValue({ content: [] });
    const getPricingOptions = vi.fn(() => undefined);
    const handlePayload = vi.fn((payload) => ({
      max_tokens: 1024,
      messages: [],
      model: payload.model,
    }));
    const createClient = vi.fn((options) => ({
      baseURL: options.baseURL,
      messages: { create: messagesCreate },
    }));
    const Runtime = createAnthropicCompatibleRuntime({
      chatCompletion: {
        getPricingOptions,
        handlePayload,
      },
      customClient: {
        createClient: (options) => createClient(options) as unknown as Anthropic,
      },
      provider: 'test-provider',
    });
    const runtime = new Runtime({
      apiKey: 'test-key',
      modelIdMapping: { 'logical-model': 'upstream-model' },
    });

    await runtime.chat({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'logical-model',
      responseMode: 'json',
      stream: false,
    } as any);

    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'upstream-model',
      }),
      expect.anything(),
    );
    expect(handlePayload).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'logical-model' }),
      expect.anything(),
    );
    expect(getPricingOptions).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'logical-model' }),
      expect.objectContaining({ model: 'logical-model' }),
    );
    expect(createClient.mock.calls[0][0]).not.toHaveProperty('modelIdMapping');
  });

  it('should keep logical model for generateObject and pass mapped id as request config', async () => {
    const generateObject = vi.fn().mockResolvedValue({ ok: true });
    const Runtime = createAnthropicCompatibleRuntime({
      chatCompletion: {
        handlePayload: (payload) => ({
          max_tokens: 1024,
          messages: [],
          model: payload.model,
        }),
      },
      customClient: {
        createClient: () =>
          ({
            baseURL: 'https://aihubmix.com',
            messages: { create: vi.fn() },
          }) as unknown as Anthropic,
      },
      generateObject,
      provider: 'test-provider',
    });
    const runtime = new Runtime({
      apiKey: 'test-key',
      modelIdMapping: { 'logical-model': 'upstream-model' },
    });

    const result = await runtime.generateObject({
      messages: [{ content: 'hi', role: 'user' }],
      model: 'logical-model',
      schema: {
        name: 'result',
        schema: { properties: {}, type: 'object' },
      },
    });

    expect(generateObject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: 'logical-model' }),
      undefined,
      undefined,
      expect.objectContaining({ requestModel: 'upstream-model' }),
    );
    expect(result).toEqual({ ok: true });
  });
});
