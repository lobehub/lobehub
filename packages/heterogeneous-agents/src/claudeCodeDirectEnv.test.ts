import { describe, expect, it } from 'vitest';

import {
  buildClaudeCodeDirectEnv,
  sanitizeClaudeCodeDirectArgs,
  sanitizeClaudeCodeDirectEnv,
} from './claudeCodeDirectEnv';

describe('Claude Code Desktop-local direct binding', () => {
  it('builds a host-managed Anthropic environment and defaults the fast model to primary', () => {
    const result = buildClaudeCodeDirectEnv({
      keyVaults: { apiKey: '  test-key  ', baseURL: '  https://example.com/anthropic  ' },
      model: 'claude-sonnet-test',
      sdkType: 'anthropic',
    });

    expect(result.error).toBeUndefined();
    expect(result.env).toEqual({
      ANTHROPIC_API_KEY: 'test-key',
      ANTHROPIC_BASE_URL: 'https://example.com/anthropic',
      ANTHROPIC_MODEL: 'claude-sonnet-test',
      ANTHROPIC_SMALL_FAST_MODEL: 'claude-sonnet-test',
      CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
      CLAUDE_CODE_USE_BEDROCK: '0',
      CLAUDE_CODE_USE_MANTLE: '0',
      CLAUDE_CODE_USE_VERTEX: '0',
    });
  });

  it('uses an explicitly bound fast model', () => {
    const result = buildClaudeCodeDirectEnv({
      keyVaults: { apiKey: 'test-key' },
      model: 'primary',
      sdkType: 'anthropic',
      smallFastModel: 'fast',
    });

    expect(result.env.ANTHROPIC_SMALL_FAST_MODEL).toBe('fast');
  });

  it.each([
    [{ apiKey: 'key' }, '', 'anthropic', /Model id/],
    [{}, 'model', 'anthropic', /apiKey/],
    [{ apiKey: 'key' }, 'model', 'openai', /sdkType/],
  ])('fails for incomplete or unsupported bindings', (keyVaults, model, sdkType, error) => {
    expect(buildClaudeCodeDirectEnv({ keyVaults, model, sdkType }).error).toMatch(error);
  });

  it('removes stale model flags in both supported CLI forms', () => {
    expect(
      sanitizeClaudeCodeDirectArgs([
        '--effort',
        'high',
        '--model',
        'subscription-model',
        '--model=other-model',
        '--verbose',
      ]),
    ).toEqual(['--effort', 'high', '--verbose']);
  });

  it('removes stale auth, model, and cloud routing env without touching unrelated env', () => {
    expect(
      sanitizeClaudeCodeDirectEnv({
        ANTHROPIC_API_KEY: 'old-key',
        ANTHROPIC_AUTH_TOKEN: 'old-token',
        ANTHROPIC_BASE_URL: 'https://old.example.com',
        ANTHROPIC_MODEL: 'old-model',
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CODE_USE_MANTLE: '1',
        CLAUDE_CODE_USE_VERTEX: '1',
        KEEP_ME: 'yes',
      }),
    ).toEqual({ KEEP_ME: 'yes' });
  });
});
