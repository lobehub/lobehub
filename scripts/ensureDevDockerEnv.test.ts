import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureDevDockerEnv } from './ensureDevDockerEnv.mts';

const tempDirectories: string[] = [];

const createFixture = async (example: string, env?: string) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lobe-dev-docker-env-'));
  tempDirectories.push(directory);
  await fs.writeFile(path.join(directory, '.env.example'), example);
  if (env !== undefined) await fs.writeFile(path.join(directory, '.env'), env);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe('ensureDevDockerEnv', () => {
  it('copies the example and generates the required SearXNG secret', async () => {
    const directory = await createFixture('LOBE_PORT=3210\nSEARXNG_SECRET=\n');

    await ensureDevDockerEnv(directory);

    const env = await fs.readFile(path.join(directory, '.env'), 'utf8');
    expect(env).toMatch(/^SEARXNG_SECRET=[\da-f]{64}$/m);
  });

  it('preserves an existing non-empty secret', async () => {
    const directory = await createFixture(
      'SEARXNG_SECRET=\n',
      'SEARXNG_SECRET=already-configured\n',
    );

    await ensureDevDockerEnv(directory);

    await expect(fs.readFile(path.join(directory, '.env'), 'utf8')).resolves.toBe(
      'SEARXNG_SECRET=already-configured\n',
    );
  });
});
