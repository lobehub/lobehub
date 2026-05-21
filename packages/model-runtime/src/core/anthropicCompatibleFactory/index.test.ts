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

const MockedAnthropic = vi.mocked(Anthropic);
const originalAnthropicClientTimeout = process.env.ANTHROPIC_CLIENT_TIMEOUT;
const originalDeepSeekAnthropicPayloadLogUserId =
  process.env.DEEPSEEK_ANTHROPIC_PAYLOAD_LOG_USER_ID;

afterEach(() => {
  if (originalAnthropicClientTimeout === undefined) {
    delete process.env.ANTHROPIC_CLIENT_TIMEOUT;
  } else {
    process.env.ANTHROPIC_CLIENT_TIMEOUT = originalAnthropicClientTimeout;
  }

  if (originalDeepSeekAnthropicPayloadLogUserId === undefined) {
    delete process.env.DEEPSEEK_ANTHROPIC_PAYLOAD_LOG_USER_ID;
  } else {
    process.env.DEEPSEEK_ANTHROPIC_PAYLOAD_LOG_USER_ID = originalDeepSeekAnthropicPayloadLogUserId;
  }
});

const createDeepSeekAnthropicJsonParseRuntime = () => {
  const apiError = Object.assign(
    new Error(
      '400 Failed to parse the request body as JSON: messages[0].content: unexpected end of hex escape at line 1 column 7160',
    ),
    { status: 400 },
  );
  const messagesCreate = vi.fn().mockRejectedValue(apiError);
  const createClient = vi.fn(
    (options) =>
      ({
        baseURL: options.baseURL,
        messages: { create: messagesCreate },
      }) as unknown as Anthropic,
  );
  const Runtime = createAnthropicCompatibleRuntime({
    baseURL: 'https://api.deepseek.com/anthropic',
    chatCompletion: {
      handlePayload: () => ({
        max_tokens: 1024,
        messages: [{ content: 'x'.repeat(8000), role: 'user' }],
        model: 'deepseek-v4-pro',
      }),
    },
    customClient: { createClient },
    provider: 'deepseek',
  });

  return new Runtime({ apiKey: 'test-key' });
};

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

  it('should log a scoped payload summary for DeepSeek Anthropic JSON parse errors', async () => {
    process.env.DEEPSEEK_ANTHROPIC_PAYLOAD_LOG_USER_ID = 'user_target';

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const runtime = createDeepSeekAnthropicJsonParseRuntime();

    try {
      await expect(
        runtime.chat({ messages: [], model: 'deepseek-v4-pro', provider: 'deepseek' } as any, {
          metadata: { traceId: 'trace-1', trigger: 'bot' },
          user: 'user_target',
        }),
      ).rejects.toBeDefined();

      const logCall = logSpy.mock.calls.find(
        ([label]) => label === '[deepseekAnthropicPayloadParseError]',
      );
      const summary = JSON.parse(logCall?.[1] as string);

      expect(summary).toMatchObject({
        column: 7160,
        errorStatus: 400,
        message0ContentSerializedLength: 8002,
        message0ContentType: 'string',
        model: 'deepseek-v4-pro',
        reportedColumn: 7160,
        reportedLine: 1,
        request: {
          maxTokens: 1024,
          metadataUserId: 'user_target',
          model: 'deepseek-v4-pro',
          stream: true,
        },
        snippetEnd: 7409,
        snippetStart: 6909,
        traceId: 'trace-1',
        trigger: 'bot',
        userId: 'user_target',
      });
      expect(summary.messageSummaries[0]).toMatchObject({
        containsColumn: true,
        content: {
          kind: 'string',
          serializedLength: 8002,
          textLength: 8000,
        },
        index: 0,
        role: 'user',
      });
      expect(summary.payloadKeys).toEqual([
        'max_tokens',
        'messages',
        'model',
        'stream',
        'metadata',
      ]);
      expect(summary.payloadLength).toBeGreaterThan(7400);
      expect(summary.snippet).toHaveLength(500);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('should skip DeepSeek Anthropic payload summary when the target user env is not configured', async () => {
    delete process.env.DEEPSEEK_ANTHROPIC_PAYLOAD_LOG_USER_ID;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const runtime = createDeepSeekAnthropicJsonParseRuntime();

    try {
      await expect(
        runtime.chat({ messages: [], model: 'deepseek-v4-pro', provider: 'deepseek' } as any, {
          metadata: { traceId: 'trace-1', trigger: 'bot' },
          user: 'user_target',
        }),
      ).rejects.toBeDefined();

      expect(logSpy).not.toHaveBeenCalledWith(
        '[deepseekAnthropicPayloadParseError]',
        expect.any(String),
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it('should skip DeepSeek Anthropic payload summary for other users', async () => {
    process.env.DEEPSEEK_ANTHROPIC_PAYLOAD_LOG_USER_ID = 'user_target';

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const runtime = createDeepSeekAnthropicJsonParseRuntime();

    try {
      await expect(
        runtime.chat({ messages: [], model: 'deepseek-v4-pro', provider: 'deepseek' } as any, {
          metadata: { traceId: 'trace-1', trigger: 'bot' },
          user: 'user_other',
        }),
      ).rejects.toBeDefined();

      expect(logSpy).not.toHaveBeenCalledWith(
        '[deepseekAnthropicPayloadParseError]',
        expect.any(String),
      );
    } finally {
      logSpy.mockRestore();
    }
  });
});
