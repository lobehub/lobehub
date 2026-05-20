// @vitest-environment node
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { createAnthropicCompatibleRuntime, createDefaultAnthropicClient } from './index';

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn();
  return { default: MockAnthropic };
});

vi.mock('@lobechat/const', () => ({
  CURRENT_VERSION: '1.0.0-test',
}));

const MockedAnthropic = vi.mocked(Anthropic);

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
      }),
    );
    expect(runtime.baseURL).toBe('https://aihubmix.com');
  });
});
