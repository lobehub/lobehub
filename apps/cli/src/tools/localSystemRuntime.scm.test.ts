import { existsSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runLocalSystemTool } from './localSystemRuntime';

const { ensureGhShimMock } = vi.hoisted(() => ({ ensureGhShimMock: vi.fn() }));
vi.mock('../scm/ghShim', () => ({ ensureGhShim: ensureGhShimMock }));

const credential = {
  gitEmail: '42+arvinxx@users.noreply.github.com',
  gitName: 'Arvin Xu',
  jwt: 'jwt-5m',
};

const probe =
  'printf "%s|%s|%s|%s|%s|%s" "$GIT_AUTHOR_NAME" "$GH_TOKEN" "$(cat "$LOBEHUB_SCM_JWT_FILE")" "$GIT_TERMINAL_PROMPT" "$LOBEHUB_SCM_JWT_FILE" "$LOBEHUB_JWT_FILE"';

const stdoutOf = (result: Awaited<ReturnType<typeof runLocalSystemTool>>) =>
  (result?.state as { stdout?: string } | undefined)?.stdout ?? result?.content ?? '';

beforeEach(() => {
  ensureGhShimMock.mockReset().mockResolvedValue('/shim/bin/gh');
  vi.stubEnv('GH_TOKEN', 'gho_device');
});

describe('runLocalSystemTool with a requester credential', () => {
  it('runs the command with the requester identity and a private JWT file, then removes it', async () => {
    const result = await runLocalSystemTool('runCommand', {
      __scmCredential: credential,
      command: probe,
      env: { GIT_AUTHOR_NAME: 'Model Chosen', GIT_TERMINAL_PROMPT: '1' },
    });

    const [author, ghToken, jwt, prompt, jwtFile, lhJwtFile] = stdoutOf(result).trim().split('|');
    expect(author).toBe('Arvin Xu');
    expect(ghToken).toBe('');
    expect(jwt).toBe('jwt-5m');
    expect(prompt).toBe('0');
    expect(existsSync(jwtFile)).toBe(false);
    expect(lhJwtFile).toBe('');
  });

  it('leaves the env alone without a credential arg', async () => {
    const result = await runLocalSystemTool('runCommand', {
      command: 'printf "%s|%s" "$GH_TOKEN" "$LOBEHUB_SCM_CREDENTIAL"',
    });

    expect(stdoutOf(result).trim()).toBe('gho_device|');
    expect(ensureGhShimMock).not.toHaveBeenCalled();
  });
});
