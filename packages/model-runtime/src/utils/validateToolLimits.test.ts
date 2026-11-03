import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ChatCompletionTool } from '../types/chat';
import { AgentRuntimeErrorType } from '../types/error';
import {
  assertToolLimits,
  TOOL_LIMIT_ERROR_TYPE,
  ToolLimitExceededError,
  validateToolLimits,
} from './validateToolLimits';

const makeTools = (count: number): ChatCompletionTool[] =>
  Array.from({ length: count }, (_, i) => ({
    function: {
      description: 'noop',
      name: `tool_${i}`,
      parameters: { properties: {}, type: 'object' },
    },
    type: 'function',
  }));

describe('ToolLimitExceededError', () => {
  it('formats message for count overage', () => {
    const err = new ToolLimitExceededError({
      maxToolCount: 128,
      model: 'gpt-5.4',
      provider: 'githubcopilot',
      toolCount: 200,
      toolPayloadBytes: 0,
    });

    expect(err.type).toBe(TOOL_LIMIT_ERROR_TYPE);
    expect(err.name).toBe('ToolLimitExceededError');
    expect(err.provider).toBe('githubcopilot');
    expect(err.model).toBe('gpt-5.4');
    expect(err.toolCount).toBe(200);
    expect(err.maxToolCount).toBe(128);
    expect(err.message).toContain('工具数量 (200)');
    expect(err.message).toContain('上限 (128)');
    expect(err.message).toContain('githubcopilot');
  });

  it('formats message for payload size overage (rounded to KB)', () => {
    const err = new ToolLimitExceededError({
      maxToolPayloadBytes: 100 * 1024,
      model: 'foo',
      provider: 'cloudflare',
      toolCount: 5,
      toolPayloadBytes: 150 * 1024,
    });

    expect(err.message).toContain('150 KB');
    expect(err.message).toContain('100 KB');
    expect(err.maxToolPayloadBytes).toBe(100 * 1024);
    expect(err.toolPayloadBytes).toBe(150 * 1024);
  });

  it('combines both messages when both limits exceeded', () => {
    const err = new ToolLimitExceededError({
      maxToolCount: 10,
      maxToolPayloadBytes: 1024,
      model: 'm',
      provider: 'p',
      toolCount: 20,
      toolPayloadBytes: 2048,
    });

    expect(err.message).toContain('工具数量');
    expect(err.message).toContain('工具 payload');
  });
});

describe('validateToolLimits', () => {
  it('is a no-op when tools is empty', () => {
    expect(() =>
      validateToolLimits({ model: 'gpt-5.4', provider: 'githubcopilot', tools: [] }),
    ).not.toThrow();
  });

  it('is a no-op when provider has no declared limits (openai)', () => {
    expect(() =>
      validateToolLimits({ model: 'gpt-4o', provider: 'openai', tools: makeTools(200) }),
    ).not.toThrow();
  });

  it('is a no-op when provider is not registered', () => {
    expect(() =>
      validateToolLimits({
        model: 'whatever',
        provider: '__not_a_real_provider__',
        tools: makeTools(500),
      }),
    ).not.toThrow();
  });

  it('passes when tool count is under maxToolCount', () => {
    expect(() =>
      validateToolLimits({
        model: 'gpt-5.4',
        provider: 'githubcopilot',
        tools: makeTools(128),
      }),
    ).not.toThrow();
  });

  it('throws when tool count exceeds the GitHub Copilot 128 limit', () => {
    expect(() =>
      validateToolLimits({
        model: 'gpt-5.4',
        provider: 'githubcopilot',
        tools: makeTools(129),
      }),
    ).toThrowError(ToolLimitExceededError);
  });

  describe('with synthetic provider limits', () => {
    const SYNTHETIC_ID = '__test_provider_with_payload_limit__';
    let originalLength: number;

    beforeEach(() => {
      originalLength = DEFAULT_MODEL_PROVIDER_LIST.length;
      DEFAULT_MODEL_PROVIDER_LIST.push({
        chatModels: [],
        id: SYNTHETIC_ID,
        name: 'Synthetic',
        settings: { maxToolPayloadBytes: 100 },
        url: 'about:blank',
      } as any);
    });

    afterEach(() => {
      DEFAULT_MODEL_PROVIDER_LIST.length = originalLength;
    });

    it('throws when payload size exceeds maxToolPayloadBytes', () => {
      // A single tool already serialises to >100 bytes
      expect(() =>
        validateToolLimits({ model: 'm', provider: SYNTHETIC_ID, tools: makeTools(2) }),
      ).toThrowError(ToolLimitExceededError);
    });
  });
});

describe('assertToolLimits', () => {
  it('re-throws as a structured AgentRuntimeError chat payload', () => {
    let caught: any;
    try {
      assertToolLimits({
        model: 'gpt-5.4',
        provider: 'githubcopilot',
        tools: makeTools(200),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(caught.errorType).toBe(AgentRuntimeErrorType.ExceededToolLimit);
    expect(caught.provider).toBe('githubcopilot');
    expect(caught.error).toMatchObject({
      maxToolCount: 128,
      toolCount: 200,
    });
    expect(caught.error.message).toContain('工具数量');
  });

  it('is a no-op when limits are not exceeded', () => {
    expect(() =>
      assertToolLimits({
        model: 'gpt-5.4',
        provider: 'githubcopilot',
        tools: makeTools(50),
      }),
    ).not.toThrow();
  });
});
