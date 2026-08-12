import { describe, expect, it } from 'vitest';

import {
  classifyHeteroProcessFailure,
  isHeteroStatusGuideErrorData,
} from './classifyProcessFailure';

describe('isHeteroStatusGuideErrorData', () => {
  it('accepts an adapter-classified terminal error carrying agentType + code', () => {
    expect(
      isHeteroStatusGuideErrorData({
        agentType: 'claude-code',
        code: 'overloaded',
        message: 'API Error: 529 Overloaded',
      }),
    ).toBe(true);
    expect(
      isHeteroStatusGuideErrorData({
        agentType: 'codex',
        code: 'working_directory_not_found',
        message: 'Working directory does not exist: /tmp/gone',
      }),
    ).toBe(true);
    expect(
      isHeteroStatusGuideErrorData({
        agentType: 'codex',
        code: 'rate_limit',
        message: 'usage limit reached',
      }),
    ).toBe(true);
    expect(
      isHeteroStatusGuideErrorData({
        agentType: 'opencode',
        code: 'auth_required',
        message: 'ProviderAuthError',
      }),
    ).toBe(true);
    expect(
      isHeteroStatusGuideErrorData({
        agentType: 'pi',
        code: 'auth_required',
        message: 'No API key found',
      }),
    ).toBe(true);
    expect(
      isHeteroStatusGuideErrorData({
        agentType: 'qoder',
        code: 'auth_required',
        message: 'Not logged in · Please run /login',
      }),
    ).toBe(true);
  });

  it('rejects payloads missing the agentType/code pair or outside the guide sets', () => {
    expect(isHeteroStatusGuideErrorData(undefined)).toBe(false);
    expect(isHeteroStatusGuideErrorData('API Error: 529 Overloaded')).toBe(false);
    expect(isHeteroStatusGuideErrorData({ message: 'API Error: 529 Overloaded' })).toBe(false);
    expect(isHeteroStatusGuideErrorData({ agentType: 'claude-code', message: 'boom' })).toBe(false);
    expect(
      isHeteroStatusGuideErrorData({ agentType: 'kimi-cli', code: 'overloaded', message: 'x' }),
    ).toBe(false);
    expect(
      isHeteroStatusGuideErrorData({
        agentType: 'claude-code',
        code: 'resume_cwd_mismatch',
        message: 'x',
      }),
    ).toBe(false);
  });
});

describe('classifyHeteroProcessFailure', () => {
  it('classifies a preflight working-directory failure separately from a missing CLI', () => {
    const result = classifyHeteroProcessFailure({
      agentType: 'codex',
      detail: 'Working directory does not exist: /tmp/gone',
      errnoCode: 'HETERO_WORKING_DIRECTORY_NOT_FOUND',
    });

    expect(result).toMatchObject({
      agentType: 'codex',
      code: 'working_directory_not_found',
      message: 'Working directory does not exist: /tmp/gone',
    });
  });

  it('classifies a raw spawn ErrnoException code as cli_not_found', () => {
    const result = classifyHeteroProcessFailure({
      agentType: 'claude-code',
      detail: 'Error: spawn claude ENOENT',
      errnoCode: 'ENOENT',
    });

    expect(result).toMatchObject({
      agentType: 'claude-code',
      code: 'cli_not_found',
      stderr: 'Error: spawn claude ENOENT',
    });
    expect(result?.message).toContain('`claude`');
  });

  it('classifies a flattened "spawn <cmd> ENOENT" stderr tail as cli_not_found', () => {
    const result = classifyHeteroProcessFailure({
      agentType: 'codex',
      detail: 'some earlier output\nError: spawn codex ENOENT',
    });

    expect(result).toMatchObject({ agentType: 'codex', code: 'cli_not_found' });
    expect(result?.message).toContain('`codex`');
  });

  it('preserves a configured command in CLI-not-found guidance', () => {
    const result = classifyHeteroProcessFailure({
      agentType: 'claude-code',
      command: '/opt/bin/claude-beta',
      detail: 'Error: spawn /opt/bin/claude-beta ENOENT',
      errnoCode: 'ENOENT',
    });

    expect(result).toMatchObject({ command: '/opt/bin/claude-beta' });
    expect(result?.message).toContain('`/opt/bin/claude-beta`');
  });

  it('classifies a missing OpenCode binary for the install guide', () => {
    const result = classifyHeteroProcessFailure({
      agentType: 'opencode',
      detail: 'Error: spawn opencode ENOENT',
      errnoCode: 'ENOENT',
    });

    expect(result).toMatchObject({ agentType: 'opencode', code: 'cli_not_found' });
    expect(result?.message).toContain('`opencode`');
  });

  it('classifies missing Pi and Pi provider credentials', () => {
    expect(
      classifyHeteroProcessFailure({
        agentType: 'pi',
        detail: 'Error: spawn pi ENOENT',
        errnoCode: 'ENOENT',
      }),
    ).toMatchObject({ agentType: 'pi', code: 'cli_not_found' });

    expect(
      classifyHeteroProcessFailure({
        agentType: 'pi',
        detail: 'No API key found for provider anthropic',
      }),
    ).toMatchObject({ agentType: 'pi', code: 'auth_required' });
  });

  it('classifies missing Qoder and its successful-exit login message', () => {
    expect(
      classifyHeteroProcessFailure({
        agentType: 'qoder',
        detail: 'Error: spawn qodercli ENOENT',
        errnoCode: 'ENOENT',
      }),
    ).toMatchObject({ agentType: 'qoder', code: 'cli_not_found' });

    const auth = classifyHeteroProcessFailure({
      agentType: 'qoder',
      detail: 'Not logged in · Please run /login',
    });
    expect(auth).toMatchObject({ agentType: 'qoder', code: 'auth_required' });
    expect(auth?.message).toContain('Qoder');
  });

  it('keeps Qoder-specific login wording scoped to Qoder', () => {
    expect(
      classifyHeteroProcessFailure({ agentType: 'qoder', detail: 'Please run /login' }),
    ).toMatchObject({ code: 'auth_required' });
    expect(
      classifyHeteroProcessFailure({ agentType: 'claude-code', detail: 'Please run /login' }),
    ).toBeUndefined();
  });

  it('classifies Claude Code not-logged-in output without relying on the adapter', () => {
    expect(
      classifyHeteroProcessFailure({
        agentType: 'claude-code',
        detail: 'Not logged in · Please run /login',
      }),
    ).toMatchObject({ agentType: 'claude-code', code: 'auth_required' });
  });

  it('does NOT treat an in-run ENOENT (no spawn context) as cli_not_found', () => {
    const result = classifyHeteroProcessFailure({
      agentType: 'claude-code',
      detail: "ENOENT: no such file or directory, open '/tmp/foo.txt'",
    });

    expect(result).toBeUndefined();
  });

  it.each([
    'Failed to authenticate with the API',
    'Invalid authentication credentials',
    'authentication_error: OAuth token expired',
    'Error: not authenticated. Run `claude login` first.',
    'Request failed: 401 Unauthorized',
  ])('classifies auth failure %j as auth_required', (detail) => {
    const result = classifyHeteroProcessFailure({ agentType: 'claude-code', detail });

    expect(result).toMatchObject({
      agentType: 'claude-code',
      code: 'auth_required',
      stderr: detail,
    });
  });

  it('prefers cli_not_found over auth patterns when both would match', () => {
    const result = classifyHeteroProcessFailure({
      agentType: 'claude-code',
      detail: 'unauthorized junk\nError: spawn claude ENOENT',
      errnoCode: 'ENOENT',
    });

    expect(result?.code).toBe('cli_not_found');
  });

  it('classifies missing and unauthenticated Amp installations', () => {
    expect(
      classifyHeteroProcessFailure({
        agentType: 'amp',
        detail: 'Error: spawn amp ENOENT',
        errnoCode: 'ENOENT',
      }),
    ).toMatchObject({
      agentType: 'amp',
      code: 'cli_not_found',
      command: 'amp',
      docsUrl: 'https://ampcode.com/manual',
    });

    expect(
      classifyHeteroProcessFailure({
        agentType: 'amp',
        detail: 'Please log in with `amp login` or configure AMP_API_KEY.',
      }),
    ).toMatchObject({ agentType: 'amp', code: 'auth_required', command: 'amp' });
  });

  it('returns undefined for unsupported agent types', () => {
    expect(
      classifyHeteroProcessFailure({
        agentType: 'kimi-cli',
        detail: 'Error: spawn kimi ENOENT',
        errnoCode: 'ENOENT',
      }),
    ).toBeUndefined();
  });

  it('returns undefined for unclassifiable failures', () => {
    expect(
      classifyHeteroProcessFailure({
        agentType: 'claude-code',
        detail: 'Agent exited with code 1',
      }),
    ).toBeUndefined();
    expect(classifyHeteroProcessFailure({ agentType: 'claude-code' })).toBeUndefined();
  });
});
