import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { git } from './exec';

let fixtureRoot: string | undefined;

const createRepo = async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'check-git-'));
  await git(['init', '-b', 'main'], fixtureRoot);
  return fixtureRoot;
};

afterEach(async () => {
  if (fixtureRoot) {
    await rm(fixtureRoot, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 });
  }
  fixtureRoot = undefined;
});

describe('git', () => {
  it('returns stdout lines for a successful command', async () => {
    const repo = await createRepo();
    await writeFile(path.join(repo, 'tracked.ts'), 'initial\n');
    await git(['add', 'tracked.ts'], repo);
    await git(
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '-m',
        'initialize',
      ],
      repo,
    );

    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo)).toEqual(['main']);
  });

  it('throws command context when HEAD is invalid', async () => {
    const repo = await createRepo();

    await expect(git(['diff', '--name-only', 'HEAD'], repo)).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringMatching(
          /Git command failed with exit code 128[\s\S]*command: \["git","diff","--name-only","HEAD"\][\s\S]*stderr: fatal:/,
        ),
      }),
    );
  });

  it('redacts a secret-looking missing cwd while preserving stderr', async () => {
    const repo = await createRepo();
    const secret = 'fixture-secret';
    const missingCwd = path.join(repo, `missing?access_token=${secret}`);

    const error = await git(['status', '--short'], missingCwd).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Git command failed with exit code 127');
    expect((error as Error).message).toContain('missing?access_token=[REDACTED]');
    expect((error as Error).message).toContain('command: ["git","status","--short"]');
    expect((error as Error).message).toContain('stderr: Error: spawn git ENOENT');
    expect((error as Error).message).not.toContain(secret);
  });

  it('bounds long stderr after redacting secrets', async () => {
    const repo = await createRepo();
    const secret = 'fixture-secret';
    const invalidRef = `refs/heads/access_token=${secret}&ref=${'x'.repeat(4096)}`;

    const error = await git(['show', invalidRef], repo).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('access_token=[REDACTED]');
    expect((error as Error).message).toContain('stderr: fatal:');
    expect((error as Error).message).toContain('… [truncated]');
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message.length).toBeLessThan(4200);
  });
});
