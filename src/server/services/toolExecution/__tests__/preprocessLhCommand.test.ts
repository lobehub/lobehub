import { describe, expect, it, vi } from 'vitest';

import { preprocessLhCommand } from '../preprocessLhCommand';

const mockSignUserJWT = vi.hoisted(() => vi.fn().mockResolvedValue('mock-jwt-token'));

vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  signUserJWT: mockSignUserJWT,
}));

vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://app.lobehub.com' },
}));

vi.mock('@/utils/env', () => ({
  isDev: false,
}));

const ENV_PREFIX = 'LOBEHUB_JWT=mock-jwt-token LOBEHUB_SERVER=https://app.lobehub.com';

describe('preprocessLhCommand', () => {
  it('should return unchanged command for non-lh commands', async () => {
    const result = await preprocessLhCommand('echo hello', 'user-1');

    expect(result.isLhCommand).toBe(false);
    expect(result.skipSkillLookup).toBe(false);
    expect(result.command).toBe('echo hello');
  });

  it('should rewrite a single lh command', async () => {
    const result = await preprocessLhCommand('lh topic list --json', 'user-1');

    expect(result.isLhCommand).toBe(true);
    expect(result.skipSkillLookup).toBe(true);
    expect(result.command).toBe(`${ENV_PREFIX} npx -y @lobehub/cli topic list --json`);
  });

  it('should rewrite all lh commands chained with &&', async () => {
    const cmd = 'lh topic list --page 1 && lh topic list --page 2 && echo "done"';
    const result = await preprocessLhCommand(cmd, 'user-1');

    expect(result.command).toBe(
      `${ENV_PREFIX} npx -y @lobehub/cli topic list --page 1 && ${ENV_PREFIX} npx -y @lobehub/cli topic list --page 2 && echo "done"`,
    );
  });

  it('should rewrite lh commands chained with ||', async () => {
    const cmd = 'lh foo || lh bar';
    const result = await preprocessLhCommand(cmd, 'user-1');

    expect(result.command).toBe(
      `${ENV_PREFIX} npx -y @lobehub/cli foo || ${ENV_PREFIX} npx -y @lobehub/cli bar`,
    );
  });

  it('should rewrite lh commands chained with ;', async () => {
    const cmd = 'lh foo; lh bar';
    const result = await preprocessLhCommand(cmd, 'user-1');

    expect(result.command).toBe(
      `${ENV_PREFIX} npx -y @lobehub/cli foo; ${ENV_PREFIX} npx -y @lobehub/cli bar`,
    );
  });

  it('should not replace lh inside other words', async () => {
    const result = await preprocessLhCommand('echoalhough', 'user-1');

    expect(result.isLhCommand).toBe(false);
    expect(result.command).toBe('echoalhough');
  });

  it('should handle bare lh command', async () => {
    const result = await preprocessLhCommand('lh', 'user-1');

    expect(result.isLhCommand).toBe(true);
    expect(result.command).toBe(`${ENV_PREFIX} npx -y @lobehub/cli`);
  });

  it('should return error when JWT signing fails', async () => {
    mockSignUserJWT.mockRejectedValueOnce(new Error('sign failed'));

    const result = await preprocessLhCommand('lh topic list', 'user-1');

    expect(result.isLhCommand).toBe(true);
    expect(result.error).toBe('Failed to authenticate for CLI execution');
    expect(result.command).toBe('lh topic list');
  });
});
