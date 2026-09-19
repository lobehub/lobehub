import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { assembleCore } from '../assembleCore.mjs';

let root;

const write = async (file, content = file) => {
  const abs = path.join(root, file);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
};

const listFiles = async (dir, prefix = '') => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out.sort();
};

const setup = async () => {
  root = await mkdtemp(path.join(tmpdir(), 'assemble-core-'));
  await write('desktop/dist/main/index.js');
  await write('desktop/dist/main/chunk.js');
  await write('desktop/dist/preload/index.js');
  await write('desktop/dist/renderer/index.html');
  await write('desktop/dist/renderer/assets/app.js');
  await write('desktop/resources/tray.png');
  await write('desktop/resources/sounds/ping.mp3');
  await write('desktop/resources/bin/auv');
  await write('desktop/resources/bin/lobe-cli.js');
  await write('desktop/resources/dmg.png');
  await write('desktop/resources/cli-package.json');
  await write('desktop/resources/locales/en-US.json');
  await write('desktop/node_modules/.pnpm/electron-log@5/node_modules/electron-log/package.json');
  await write('desktop/node_modules/.pnpm/electron-log@5/node_modules/electron-log/main.js');
  await symlink(
    path.join(root, 'desktop/node_modules/.pnpm/electron-log@5/node_modules/electron-log'),
    path.join(root, 'desktop/node_modules/electron-log'),
  );
  await write('cli/dist/index.js', 'cli');
  await write(
    'cli/package.json',
    JSON.stringify({ name: '@lobehub/cli', version: '1.2.3', bin: {} }),
  );
  return {
    cliDir: path.join(root, 'cli'),
    desktopDir: path.join(root, 'desktop'),
    out: path.join(root, 'out'),
  };
};

afterEach(async () => {
  if (root) await rm(root, { force: true, recursive: true });
});

describe('assembleCore', () => {
  it('produces the core layout with resources exclusions and dereferenced electron-log', async () => {
    const options = await setup();
    await write('out/stale.txt');
    assembleCore(options);

    expect(await listFiles(options.out)).toEqual([
      'cli/lobe-cli.js',
      'cli/package.json',
      'dist/main/chunk.js',
      'dist/main/index.js',
      'dist/preload/index.js',
      'dist/renderer/assets/app.js',
      'dist/renderer/index.html',
      'node_modules/electron-log/main.js',
      'node_modules/electron-log/package.json',
      'package.json',
      'resources/sounds/ping.mp3',
      'resources/tray.png',
    ]);
    expect(await readFile(path.join(options.out, 'cli/lobe-cli.js'), 'utf8')).toBe('cli');
    expect(JSON.parse(await readFile(path.join(options.out, 'package.json'), 'utf8'))).toEqual({
      type: 'commonjs',
    });
    expect(JSON.parse(await readFile(path.join(options.out, 'cli/package.json'), 'utf8'))).toEqual({
      name: '@lobehub/cli',
      type: 'module',
      version: '1.2.3',
    });
  });

  it('throws when dist/main is missing', async () => {
    const options = await setup();
    await rm(path.join(options.desktopDir, 'dist/main'), { recursive: true });
    expect(() => assembleCore(options)).toThrow(/dist\/main/);
  });
});
