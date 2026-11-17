import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyScmCredentialEnv, SCM_CREDENTIAL_BLOCKED_ENV } from './credentialEnv';
import { ensureGhShim } from './ghShim';

let root: string;

const writeScript = (file: string, body: string) => {
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'lh-scm-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('applyScmCredentialEnv', () => {
  it('names the requester as author and committer and drops inherited GitHub tokens', () => {
    const env = applyScmCredentialEnv(
      { GH_TOKEN: 'gho_device', GITHUB_TOKEN: 'gho_device', PATH: '/usr/bin' },
      {
        gitEmail: '42+arvinxx@users.noreply.github.com',
        gitName: 'Arvin Xu',
        helperCommand: '!lh git credential',
        shimDir: path.join(root, 'shim'),
      },
    );

    expect(env).toMatchObject({
      GIT_AUTHOR_EMAIL: '42+arvinxx@users.noreply.github.com',
      GIT_AUTHOR_NAME: 'Arvin Xu',
      GIT_COMMITTER_EMAIL: '42+arvinxx@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'Arvin Xu',
      GIT_TERMINAL_PROMPT: '0',
      GH_CONFIG_DIR: path.join(root, 'shim', 'gh-config'),
      PATH: `${path.join(root, 'shim', 'bin')}${path.delimiter}/usr/bin`,
    });
    for (const key of SCM_CREDENTIAL_BLOCKED_ENV) expect(env).not.toHaveProperty(key);
  });

  it('appends its git config after config entries the environment already carries', () => {
    const env = applyScmCredentialEnv(
      { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.pager', GIT_CONFIG_VALUE_0: 'cat' },
      { helperCommand: '!lh git credential', shimDir: path.join(root, 'shim') },
    );

    expect(env.GIT_CONFIG_KEY_0).toBe('core.pager');
    expect(env.GIT_CONFIG_KEY_1).toBe('credential.https://github.com.helper');
    expect(env.GIT_CONFIG_VALUE_1).toBe('');
    expect(Number(env.GIT_CONFIG_COUNT)).toBeGreaterThan(2);
  });

  it('leaves the author alone when the requester has no GitHub identity yet', () => {
    const env = applyScmCredentialEnv(
      {},
      { helperCommand: '!lh git credential', shimDir: path.join(root, 'shim') },
    );

    expect(env).not.toHaveProperty('GIT_AUTHOR_NAME');
    expect(env).not.toHaveProperty('GIT_COMMITTER_EMAIL');
  });
});

describe('applyScmCredentialEnv with real git', () => {
  const gitEnv = () => {
    const home = path.join(root, 'home');
    execFileSync('mkdir', ['-p', home]);
    const deviceHelper = writeScript(
      path.join(root, 'device-helper'),
      'cat >/dev/null; echo username=device; echo password=device-token',
    );
    const ghHelper = writeScript(
      path.join(root, 'gh-helper'),
      'cat >/dev/null; echo username=gh; echo password=gh-device-token',
    );
    const requesterHelper = writeScript(
      path.join(root, 'requester-helper'),
      'cat >/dev/null; echo username=x-access-token; echo password=requester-token',
    );
    writeFileSync(
      path.join(home, '.gitconfig'),
      `[credential]\n\thelper = !${deviceHelper}\n[credential "https://github.com"]\n\thelper = !${ghHelper}\n`,
    );

    return applyScmCredentialEnv(
      { HOME: home, PATH: process.env.PATH, XDG_CONFIG_HOME: path.join(home, '.config') },
      { helperCommand: `!${requesterHelper}`, shimDir: path.join(root, 'shim') },
    );
  };

  const fill = (env: NodeJS.ProcessEnv, input: string) =>
    execFileSync('git', ['credential', 'fill'], { encoding: 'utf8', env, input });

  it('answers github.com only from the requester helper, ignoring the device logins', () => {
    const output = fill(gitEnv(), 'protocol=https\nhost=github.com\npath=lobehub/lobehub.git\n\n');

    expect(output).toContain('password=requester-token');
    expect(output).not.toContain('device-token');
  });

  it('keeps the device credentials for other hosts', () => {
    const output = fill(gitEnv(), 'protocol=https\nhost=gitlab.com\n\n');

    expect(output).toContain('password=device-token');
  });

  it('rewrites SSH remotes on github.com to HTTPS so they use the helper too', () => {
    const env = gitEnv();
    const rewrite = (url: string) =>
      execFileSync('git', ['ls-remote', '--get-url', url], { encoding: 'utf8', env }).trim();

    expect(rewrite('git@github.com:lobehub/lobehub.git')).toBe(
      'https://github.com/lobehub/lobehub.git',
    );
    expect(rewrite('ssh://git@github.com/lobehub/lobehub.git')).toBe(
      'https://github.com/lobehub/lobehub.git',
    );
  });
});

describe('ensureGhShim', () => {
  it('runs the real gh with the requester token and an isolated config', async () => {
    const realBin = path.join(root, 'real-bin');
    execFileSync('mkdir', ['-p', realBin]);
    writeScript(path.join(realBin, 'gh'), 'echo "token=$GH_TOKEN config=$GH_CONFIG_DIR args=$*"');
    const helper = writeScript(
      path.join(root, 'requester-helper'),
      'cat >/dev/null; echo username=x-access-token; echo password=requester-token',
    );
    const shimDir = path.join(root, 'shim');

    await ensureGhShim(shimDir, helper);
    const env = applyScmCredentialEnv(
      { GH_TOKEN: 'gho_device', PATH: `${realBin}:/usr/bin:/bin` },
      { helperCommand: `!${helper}`, shimDir },
    );
    const output = execFileSync('gh', ['pr', 'create', '--fill'], { encoding: 'utf8', env });

    expect(output.trim()).toBe(
      `token=requester-token config=${path.join(shimDir, 'gh-config')} args=pr create --fill`,
    );
  });

  it('fails instead of running gh with the device login when no credential is issued', async () => {
    const realBin = path.join(root, 'real-bin');
    execFileSync('mkdir', ['-p', realBin]);
    writeScript(path.join(realBin, 'gh'), 'echo ran');
    const helper = writeScript(
      path.join(root, 'failing-helper'),
      'cat >/dev/null; echo nope >&2; exit 1',
    );
    const shimDir = path.join(root, 'shim');

    await ensureGhShim(shimDir, helper);
    const env = applyScmCredentialEnv(
      { PATH: `${realBin}:/usr/bin:/bin` },
      { helperCommand: `!${helper}`, shimDir },
    );

    expect(() =>
      execFileSync('gh', ['auth', 'status'], { encoding: 'utf8', env, stdio: 'pipe' }),
    ).toThrow(/no GitHub credential was issued/);
  });
});
