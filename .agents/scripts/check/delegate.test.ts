import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { detectHostCheckRoot } from './delegate';
import { run } from './exec';

const enginePath = fileURLToPath(new URL('./index.ts', import.meta.url));
const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
let fixtureRoot: string | undefined;

const git = async (cwd: string, ...args: string[]) => {
  const result = await run(
    'git',
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    cwd,
  );
  expect(result.code, result.stderr).toBe(0);
  return result.stdout.trim();
};

const createFixture = async () => {
  fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'check-worktree-'));
  const host = path.join(fixtureRoot, 'host');
  const library = path.join(fixtureRoot, 'library');
  await git(fixtureRoot, 'init', '-b', 'main', library);
  await writeFile(path.join(library, 'README.md'), 'library\n');
  await git(library, 'add', 'README.md');
  await git(library, 'commit', '-m', 'initialize library');
  await git(fixtureRoot, 'init', '-b', 'main', host);
  await writeFile(
    path.join(host, 'package.json'),
    JSON.stringify({
      scripts: { 'check': 'bun run ./host-check.ts', 'type-check': 'bun run ./host-check.ts' },
    }),
  );
  await writeFile(path.join(host, 'host-check.ts'), 'console.log("HOST_CHECK");\n');
  await git(
    host,
    '-c',
    'protocol.file.allow=always',
    'submodule',
    'add',
    library,
    'vendor/library',
  );
  await git(host, 'add', 'package.json', 'host-check.ts', '.gitmodules', 'vendor/library');
  await git(host, 'commit', '-m', 'initialize host');
  return { host, library };
};

afterEach(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { force: true, recursive: true });
  fixtureRoot = undefined;
});

describe('check entry worktree selection', () => {
  it('delegates a normal submodule to its containing host', async () => {
    const { host } = await createFixture();
    const detected = await detectHostCheckRoot(path.join(host, 'vendor/library'));
    expect(detected && (await realpath(detected))).toBe(await realpath(host));
  });

  it('delegates a submodule in a linked host worktree to that worktree', async () => {
    const { host } = await createFixture();
    const selected = path.join(fixtureRoot!, 'selected');
    await git(host, 'worktree', 'add', '-b', 'feature/selected', selected);
    await git(selected, '-c', 'protocol.file.allow=always', 'submodule', 'update', '--init');

    const detected = await detectHostCheckRoot(path.join(selected, 'vendor/library'));
    expect(detected && (await realpath(detected))).toBe(await realpath(selected));
  });

  it('does not delegate a standalone worktree of a submodule to its old host', async () => {
    const { host } = await createFixture();
    const standalone = path.join(fixtureRoot!, 'standalone');
    await git(
      path.join(host, 'vendor/library'),
      'worktree',
      'add',
      '-b',
      'feature/library',
      standalone,
    );

    expect(await detectHostCheckRoot(standalone)).toBeNull();
  });

  it('does not delegate a nested repository that is not a submodule', async () => {
    const { host } = await createFixture();
    const nested = path.join(host, 'scratch');
    await git(host, 'init', '-b', 'main', nested);

    expect(await detectHostCheckRoot(nested)).toBeNull();
  });

  it('delegates an independent clone mounted at a tracked submodule path', async () => {
    const { host, library } = await createFixture();
    const mounted = path.join(host, 'vendor/library');
    await rm(mounted, { force: true, recursive: true });
    await git(host, 'clone', library, mounted);

    const detected = await detectHostCheckRoot(mounted);
    expect(detected && (await realpath(detected))).toBe(await realpath(host));
  });

  it.each(['--lint', '--type'])(
    'rejects a foreign host entry before running %s',
    async (selector) => {
      const { host } = await createFixture();
      const selected = path.join(fixtureRoot!, 'selected');
      await git(host, 'worktree', 'add', '-b', 'feature/selected', selected);
      await writeFile(path.join(host, 'anchor.txt'), 'anchor draft\n');
      await writeFile(path.join(selected, 'selected.txt'), 'selected draft\n');
      const formatter = path.join(host, 'node_modules/.bin/fixture-format');
      await mkdir(path.dirname(formatter), { recursive: true });
      await writeFile(
        formatter,
        '#!/usr/bin/env bun\nawait Bun.write(process.argv.at(-1), "formatted wrong checkout\\n");\n',
      );
      await chmod(formatter, 0o755);
      const entry = path.join(fixtureRoot!, 'entry.ts');
      await writeFile(
        entry,
        `import { runCli } from ${JSON.stringify(enginePath)};\n` +
          `await runCli(${JSON.stringify({
            repos: [{ dir: '', pipelines: [{ exts: ['.txt'], tools: [['fixture-format']] }] }],
            rootDir: host,
          })});\n`,
      );

      const result = await run('bun', ['run', entry, selector], selected);

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('checkout');
      expect(result.stderr).not.toContain('Error:');
      expect(result.stdout).not.toContain('HOST_CHECK');
      expect(await readFile(path.join(host, 'anchor.txt'), 'utf8')).toBe('anchor draft\n');
      expect(await readFile(path.join(selected, 'selected.txt'), 'utf8')).toBe('selected draft\n');
    },
  );

  it('accepts a host entry invoked from one of its mounted repositories', async () => {
    const { host } = await createFixture();
    const entry = path.join(fixtureRoot!, 'entry.ts');
    await writeFile(
      entry,
      `import { runCli } from ${JSON.stringify(enginePath)};\n` +
        `await runCli(${JSON.stringify({
          repos: [
            { dir: '', pipelines: [] },
            { dir: 'vendor/library', pipelines: [] },
          ],
          rootDir: host,
        })});\n`,
    );

    const result = await run('bun', ['run', entry, '--test'], path.join(host, 'vendor/library'));

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('nothing to check');
  });

  it('rejects a foreign standalone entry before delegating or collecting files', async () => {
    const { host, library } = await createFixture();
    const copiedScripts = path.join(host, 'vendor/library/.agents/scripts/check');
    await cp(path.dirname(cliPath), copiedScripts, {
      filter: (source) => !source.endsWith('.test.ts'),
      recursive: true,
    });
    const result = await run('bun', ['run', path.join(copiedScripts, 'cli.ts'), '--test'], library);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('checkout');
    expect(result.stderr).not.toContain('crashed');
    expect(result.stdout).not.toContain('delegating');
  });
});
