import { describe, expect, it } from 'vitest';

import { classifyHeteroProcessFailure } from './classifyProcessFailure';

describe('classifyHeteroProcessFailure', () => {
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

  it('returns undefined for unsupported agent types', () => {
    expect(
      classifyHeteroProcessFailure({
        agentType: 'amp',
        detail: 'Error: spawn amp ENOENT',
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
