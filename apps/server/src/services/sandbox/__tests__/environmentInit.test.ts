import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildSandboxEnvironmentInitCommand,
  environmentInitRan,
  environmentInitReport,
  type SandboxInitialization,
  toSandboxInitialization,
} from '../environmentInit';

const sandbox = { home: '', tmp: '' };

const run = (command: string, cwd: string) => {
  const env = { ...process.env, HOME: sandbox.home, TMPDIR: sandbox.tmp };
  try {
    return {
      status: 0,
      stdout: execFileSync('bash', ['-c', command], { cwd, encoding: 'utf8', env }),
    };
  } catch (error) {
    const failure = error as { status: number; stdout: string };
    return { status: failure.status, stdout: failure.stdout };
  }
};

describe('toSandboxInitialization', () => {
  it('keeps git sources, setup and variables', () => {
    expect(
      toSandboxInitialization({
        configuration: {
          bootstrapCommand: '  pnpm install  ',
          env: { REGION: 'us' },
          sources: [
            { kind: 'git', ref: 'main', url: 'https://github.com/a/b.git' },
            { kind: 'files', uri: 's3://legacy' },
          ],
        },
        id: 'env_1',
        name: 'Tools',
      }),
    ).toEqual({
      bootstrapCommand: 'pnpm install',
      env: { REGION: 'us' },
      environmentId: 'env_1',
      name: 'Tools',
      sources: [{ ref: 'main', url: 'https://github.com/a/b.git' }],
    });
  });

  it('asks for nothing when the environment has neither a repository nor setup', () => {
    expect(
      toSandboxInitialization({
        configuration: { sources: [{ kind: 'files', uri: 's3://x' }] },
        id: 'env_1',
        name: 'Empty',
      }),
    ).toBeUndefined();
  });
});

describe('buildSandboxEnvironmentInitCommand', () => {
  let root: string;
  let repo: string;
  let work: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lobe-env-init-'));
    repo = join(root, 'repo');
    work = join(root, 'work');
    mkdirSync(repo);
    mkdirSync(work);
    sandbox.home = join(root, 'home');
    sandbox.tmp = join(root, 'tmp');
    mkdirSync(sandbox.home);
    mkdirSync(sandbox.tmp);
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: repo,
        env: {
          ...process.env,
          GIT_AUTHOR_EMAIL: 't@t',
          GIT_AUTHOR_NAME: 't',
          GIT_COMMITTER_EMAIL: 't@t',
          GIT_COMMITTER_NAME: 't',
        },
      });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'README.md'), 'hello');
    git('add', '.');
    git('commit', '-qm', 'init');
  });

  afterEach(() => rmSync(root, { force: true, recursive: true }));

  const init = (overrides: Partial<SandboxInitialization> = {}): SandboxInitialization => ({
    bootstrapCommand: 'echo "$REGION" > setup.txt',
    env: { REGION: 'eu' },
    environmentId: 'env_1',
    name: "Bob's tools",
    sources: [{ url: `file://${repo}` }],
    ...overrides,
  });

  it('clones the repository with its history and runs setup with the variables, leaving nothing of its own', () => {
    const result = run(buildSandboxEnvironmentInitCommand(init()), work);

    expect(result.status).toBe(0);
    expect(environmentInitRan(result.stdout)).toBe(true);
    expect(environmentInitReport(result.stdout)).toBe(
      `Initialized from the environment Bob's tools.`,
    );
    expect(readFileSync(join(work, 'README.md'), 'utf8')).toBe('hello');
    expect(existsSync(join(work, '.git'))).toBe(true);
    expect(readFileSync(join(work, 'setup.txt'), 'utf8').trim()).toBe('eu');
    // Only what the repository and setup put there: no marker beside them.
    expect(readdirSync(work).sort()).toEqual(['.git', 'README.md', 'setup.txt']);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: work, encoding: 'utf8' })).toBe(
      '?? setup.txt\n',
    );
  });

  it('does nothing and prints nothing once the folder holds the checkout', () => {
    const command = buildSandboxEnvironmentInitCommand(init());
    run(command, work);
    rmSync(join(work, 'setup.txt'));

    const again = run(command, work);

    expect(again).toEqual({ status: 0, stdout: '' });
    expect(existsSync(join(work, 'setup.txt'))).toBe(false);
  });

  it('leaves a folder that already holds files alone, silently', () => {
    writeFileSync(join(work, 'mine.txt'), 'work');

    const result = run(buildSandboxEnvironmentInitCommand(init()), work);

    expect(result).toEqual({ status: 0, stdout: '' });
    expect(existsSync(join(work, 'README.md'))).toBe(false);
  });

  it('runs a setup that writes nothing into the folder once, not on every call', () => {
    // A global install leaves the folder empty, and each tool call starts a
    // fresh service: the record in the sandbox is what stops a rerun.
    const command = buildSandboxEnvironmentInitCommand(
      init({ bootstrapCommand: 'echo ran >> "$HOME/setup-runs"', sources: [] }),
    );

    expect(environmentInitRan(run(command, work).stdout)).toBe(true);
    expect(run(command, work).stdout).toBe('');
    expect(readFileSync(join(sandbox.home, 'setup-runs'), 'utf8')).toBe('ran\n');
    expect(readdirSync(work)).toEqual([]);
  });

  it('reports a failed setup once rather than retrying it on every call', () => {
    const command = buildSandboxEnvironmentInitCommand(
      init({ bootstrapCommand: 'exit 7', sources: [] }),
    );

    expect(environmentInitReport(run(command, work).stdout)).toContain('failed (exit 7)');
    expect(run(command, work).stdout).toBe('');
  });

  it('initializes another empty folder with the same environment on its own', () => {
    const command = buildSandboxEnvironmentInitCommand(init());
    const other = join(root, 'other');
    mkdirSync(other);

    run(command, work);

    expect(environmentInitRan(run(command, other).stdout)).toBe(true);
    expect(existsSync(join(other, 'README.md'))).toBe(true);
  });

  it('leaves no staging copy of the repository behind, whether setup succeeds or fails', () => {
    run(buildSandboxEnvironmentInitCommand(init()), work);
    const failing = join(root, 'failing');
    mkdirSync(failing);
    run(buildSandboxEnvironmentInitCommand(init({ bootstrapCommand: 'exit 3' })), failing);

    expect(readdirSync(sandbox.tmp)).toEqual([]);
  });

  it('gives git the clone credential for the clones alone, and keeps it out of the checkout', () => {
    const result = run(
      buildSandboxEnvironmentInitCommand(
        init({
          bootstrapCommand: 'echo "[$GIT_CONFIG_VALUE_0]" > seen.txt',
          cloneCredential: {
            header: 'Authorization: Basic c2VjcmV0',
            urlPrefix: 'https://github.com/',
          },
        }),
      ),
      work,
    );

    expect(environmentInitReport(result.stdout)).toContain('Initialized');
    // Setup, which runs after the clones, cannot read it back.
    expect(readFileSync(join(work, 'seen.txt'), 'utf8').trim()).toBe('[]');
    expect(readFileSync(join(work, '.git', 'config'), 'utf8')).not.toContain('c2VjcmV0');
    expect(result.stdout).not.toContain('c2VjcmV0');
  });

  it('keeps the variables out of the shell that runs afterwards', () => {
    run(buildSandboxEnvironmentInitCommand(init()), work);

    expect(
      run(`${buildSandboxEnvironmentInitCommand(init())}; echo "[$REGION]"`, work).stdout,
    ).toBe('[]\n');
  });

  it('refuses a source path that leaves the working directory', () => {
    const result = run(
      buildSandboxEnvironmentInitCommand(
        init({ sources: [{ path: '../out', url: `file://${repo}` }] }),
      ),
      work,
    );

    expect(result.stdout).toContain('unusable path');
    expect(existsSync(join(root, 'out'))).toBe(false);
  });
});
