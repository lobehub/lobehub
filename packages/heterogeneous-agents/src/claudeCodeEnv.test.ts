import { describe, expect, it } from 'vitest';

import { buildClaudeCodeApiEnv } from './claudeCodeEnv';

describe('buildClaudeCodeApiEnv', () => {
  describe('anthropic sdkType', () => {
    it('maps apiKey + model into ANTHROPIC_API_KEY + ANTHROPIC_MODEL', () => {
      const result = buildClaudeCodeApiEnv({
        keyVaults: { apiKey: 'sk-ant-test' },
        model: 'claude-sonnet-4-5',
        sdkType: 'anthropic',
      });

      expect(result.error).toBeUndefined();
      expect(result.env).toEqual({
        ANTHROPIC_API_KEY: 'sk-ant-test',
        ANTHROPIC_MODEL: 'claude-sonnet-4-5',
      });
    });

    it('adds ANTHROPIC_BASE_URL when keyVaults.baseURL is provided', () => {
      const result = buildClaudeCodeApiEnv({
        keyVaults: { apiKey: 'key', baseURL: 'https://api.moonshot.cn/anthropic' },
        model: 'kimi-k2',
        sdkType: 'anthropic',
      });

      expect(result.env.ANTHROPIC_BASE_URL).toBe('https://api.moonshot.cn/anthropic');
    });

    it('omits ANTHROPIC_BASE_URL when baseURL is missing or blank', () => {
      const result = buildClaudeCodeApiEnv({
        keyVaults: { apiKey: 'key', baseURL: '   ' },
        model: 'claude-sonnet-4-5',
        sdkType: 'anthropic',
      });

      expect(result.env.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it('adds ANTHROPIC_SMALL_FAST_MODEL only when provided', () => {
      const withFast = buildClaudeCodeApiEnv({
        keyVaults: { apiKey: 'key' },
        model: 'claude-sonnet-4-5',
        sdkType: 'anthropic',
        smallFastModel: 'claude-haiku-4-5',
      });
      expect(withFast.env.ANTHROPIC_SMALL_FAST_MODEL).toBe('claude-haiku-4-5');

      const without = buildClaudeCodeApiEnv({
        keyVaults: { apiKey: 'key' },
        model: 'claude-sonnet-4-5',
        sdkType: 'anthropic',
      });
      expect(without.env.ANTHROPIC_SMALL_FAST_MODEL).toBeUndefined();
    });

    it('returns an error when apiKey is missing', () => {
      const result = buildClaudeCodeApiEnv({
        keyVaults: {},
        model: 'claude-sonnet-4-5',
        sdkType: 'anthropic',
      });

      expect(result.env).toEqual({});
      expect(result.error).toMatch(/apiKey/);
    });

    it('trims whitespace from credentials', () => {
      const result = buildClaudeCodeApiEnv({
        keyVaults: { apiKey: '  sk-ant-test  ', baseURL: '  https://x.com  ' },
        model: 'claude-sonnet-4-5',
        sdkType: 'anthropic',
      });

      expect(result.env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
      expect(result.env.ANTHROPIC_BASE_URL).toBe('https://x.com');
    });
  });

  it('errors when model id is empty', () => {
    const result = buildClaudeCodeApiEnv({
      keyVaults: { apiKey: 'key' },
      model: '',
      sdkType: 'anthropic',
    });

    expect(result.error).toMatch(/Model/);
  });

  it('errors for unsupported sdkType', () => {
    const result = buildClaudeCodeApiEnv({
      keyVaults: { apiKey: 'key' },
      model: 'gpt-4',
      sdkType: 'openai',
    });

    expect(result.env).toEqual({});
    expect(result.error).toMatch(/sdkType/);
  });

  it('errors when sdkType is undefined', () => {
    const result = buildClaudeCodeApiEnv({
      keyVaults: { apiKey: 'key' },
      model: 'x',
    });

    expect(result.error).toMatch(/sdkType/);
  });
});
