// @vitest-environment node
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { serveFixtures } from './fixtureServer';

describe('fixture asset boundary', () => {
  it('serves only explicit build roots and refuses symlink escapes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'stylex-server-test-'));
    const base = path.join(root, 'base');
    const candidate = path.join(root, 'candidate');
    await mkdir(base);
    await mkdir(candidate);
    await writeFile(path.join(root, 'outside.txt'), 'must not expose');
    await writeFile(path.join(base, 'index.html'), '<main>base</main>');
    await writeFile(path.join(candidate, 'index.html'), '<main>candidate</main>');
    await symlink(path.join(root, 'outside.txt'), path.join(base, 'escape.txt'));
    const server = await serveFixtures({ base, candidate });
    try {
      expect(await (await fetch(server.origin + '/base/')).text()).toBe('<main>base</main>');
      expect(await (await fetch(server.origin + '/candidate/')).text()).toBe(
        '<main>candidate</main>',
      );
      expect((await fetch(server.origin + '/base/escape.txt')).status).toBe(403);
      expect((await fetch(server.origin + '/base/%2e%2e%2foutside.txt')).status).not.toBe(200);
      expect((await fetch(server.origin + '/unrelated/')).status).toBe(404);
      expect((await fetch(server.origin + '/base/', { method: 'POST' })).status).toBe(404);
    } finally {
      await server.close();
      await rm(root, { force: true, recursive: true });
    }
  });
});
