import { execFile, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultGetProjectFileIndex,
  defaultListProjectDirectory,
  defaultSearchProjectFiles,
} from '../projectFileIndex';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('defaultGetProjectFileIndex', () => {
  it('indexes a git repo via ls-files (tracked + untracked) with directory entries', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-index-git-'));
    cleanup.push(dir);
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'index.ts'), 'export const a = 1;\n');
    await writeFile(path.join(dir, 'README.md'), '# hi\n');
    await writeFile(path.join(dir, '.gitignore'), '.env.local\ncache/\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
    // Untracked-but-not-ignored file is included via ls-files --others.
    await writeFile(path.join(dir, 'scratch.txt'), 'tmp\n');
    await mkdir(path.join(dir, 'cache'), { recursive: true });
    await writeFile(path.join(dir, 'cache', 'artifact.bin'), 'ignored\n');
    await writeFile(path.join(dir, '.env.local'), 'TOKEN=test\n');

    const result = await defaultGetProjectFileIndex({ scope: dir });

    expect(result.source).toBe('git');
    const rels = result.entries.map((e) => e.relativePath);
    expect(rels).toContain('src/index.ts');
    expect(rels).toContain('README.md');
    expect(rels).toContain('scratch.txt');
    expect(result.entries.find((entry) => entry.relativePath === '.env.local')).toMatchObject({
      gitIgnored: true,
      isDirectory: false,
    });
    expect(result.entries.find((entry) => entry.relativePath === 'cache/')).toMatchObject({
      gitIgnored: true,
      isDirectory: true,
    });
    // Fully ignored directories are represented by one collapsed entry instead
    // of recursively indexing potentially enormous dependency/build trees.
    expect(rels).not.toContain('cache/artifact.bin');
    // The intermediate directory is surfaced as its own entry.
    expect(result.entries.find((e) => e.relativePath === 'src/')?.isDirectory).toBe(true);
    expect(result).not.toHaveProperty('totalCount');
  });

  it('keeps ignored directories unique when git also lists their descendants', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-index-ignored-parents-'));
    cleanup.push(dir);
    const git = promisify(execFile);
    await git('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: dir });
    await mkdir(path.join(dir, '.husky', '_'), { recursive: true });
    await writeFile(path.join(dir, '.husky', '_', '.gitignore'), '**\n');
    await writeFile(path.join(dir, '.husky', '_', 'hook'), 'hook\n');

    const result = await defaultGetProjectFileIndex({ scope: dir });
    const paths = result.entries.map((entry) => entry.relativePath);

    expect(result.source).toBe('git');
    expect(new Set(paths).size).toBe(paths.length);
    for (const relativePath of ['.husky/', '.husky/_/']) {
      expect(result.entries.filter((entry) => entry.relativePath === relativePath)).toEqual([
        expect.objectContaining({ gitIgnored: true, isDirectory: true }),
      ]);
    }
    expect(paths).toContain('.husky/_/hook');
    // Its children are already indexed, so nothing is left to fetch on expand.
    expect(result.entries.find((entry) => entry.relativePath === '.husky/_/')?.collapsed).toBe(
      undefined,
    );
  });

  it('flags a collapsed ignored directory so its children can be fetched on expand', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-index-collapsed-'));
    cleanup.push(dir);
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: dir });
    await writeFile(path.join(dir, '.gitignore'), 'traces/\n');
    await mkdir(path.join(dir, 'traces', 'nested'), { recursive: true });
    await writeFile(path.join(dir, 'traces', 'one.json'), '{}\n');
    await writeFile(path.join(dir, 'traces', 'nested', 'two.json'), '{}\n');

    const result = await defaultGetProjectFileIndex({ scope: dir });

    expect(result.entries.find((entry) => entry.relativePath === 'traces/')).toMatchObject({
      collapsed: true,
      gitIgnored: true,
      isDirectory: true,
    });
    expect(result.entries.map((entry) => entry.relativePath)).not.toContain('traces/one.json');
  });

  it('falls back to a glob walk when the scope is not a git repo', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-index-glob-'));
    cleanup.push(dir);
    await mkdir(path.join(dir, 'nested', 'deep'), { recursive: true });
    await mkdir(path.join(dir, '.agents'), { recursive: true });
    await mkdir(path.join(dir, 'empty'));
    await mkdir(path.join(dir, '.hidden-empty'));
    await mkdir(path.join(dir, 'node_modules', 'dependency'), { recursive: true });
    await writeFile(path.join(dir, 'node_modules', 'dependency', 'index.js'), 'ignored');
    await writeFile(path.join(dir, 'one.txt'), '1\n');
    await writeFile(path.join(dir, 'nested', 'deep', 'two.txt'), '2\n');
    await writeFile(path.join(dir, '.agents', 'config.md'), '# cfg\n');

    const result = await defaultGetProjectFileIndex({ scope: dir });

    expect(result.source).toBe('glob');
    const rels = result.entries.map((entry) => entry.relativePath);
    const byRel = Object.fromEntries(result.entries.map((e) => [e.relativePath, e]));
    expect(new Set(rels).size).toBe(rels.length);
    expect(byRel['empty/']?.isDirectory).toBe(true);
    expect(byRel['.hidden-empty/']?.isDirectory).toBe(true);
    expect(rels.some((relativePath) => relativePath.startsWith('node_modules/'))).toBe(false);

    // Nested files are present and attached to synthesized directory entries.
    expect(byRel['nested/deep/two.txt']?.isDirectory).toBe(false);
    expect(byRel['nested/']?.isDirectory).toBe(true);
    expect(byRel['nested/deep/']?.isDirectory).toBe(true);

    // Dot-directories (and their files) are preserved, matching the git path.
    expect(byRel['.agents/']?.isDirectory).toBe(true);
    expect(byRel['.agents/config.md']?.isDirectory).toBe(false);

    expect(result).not.toHaveProperty('totalCount');
  });
});

describe('defaultListProjectDirectory', () => {
  it('lists one level of a collapsed directory, flagging subdirectories for the next expand', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-list-dir-'));
    cleanup.push(dir);
    await mkdir(path.join(dir, 'traces', 'nested'), { recursive: true });
    await writeFile(path.join(dir, 'traces', 'one.json'), '{}\n');
    await writeFile(path.join(dir, 'traces', 'nested', 'two.json'), '{}\n');

    const result = await defaultListProjectDirectory({ relativePath: 'traces/', root: dir });

    expect(result.truncated).toBe(false);
    expect(result.entries).toEqual([
      expect.objectContaining({
        collapsed: true,
        gitIgnored: true,
        isDirectory: true,
        relativePath: 'traces/nested/',
      }),
      expect.objectContaining({
        gitIgnored: true,
        isDirectory: false,
        relativePath: 'traces/one.json',
      }),
    ]);
    expect(result.entries[1]).not.toHaveProperty('collapsed');
  });

  it('reports truncation instead of returning an unbounded directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-list-dir-limit-'));
    cleanup.push(dir);
    await mkdir(path.join(dir, 'many'), { recursive: true });
    await Promise.all(
      Array.from({ length: 5 }).map((_, index) =>
        writeFile(path.join(dir, 'many', `file-${index}.txt`), 'x\n'),
      ),
    );

    const result = await defaultListProjectDirectory({
      limit: 2,
      relativePath: 'many',
      root: dir,
    });

    expect(result.entries).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('refuses to walk outside the project root', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-list-dir-escape-'));
    cleanup.push(dir);

    await expect(defaultListProjectDirectory({ relativePath: '../', root: dir })).rejects.toThrow(
      'outside the project root',
    );
  });

  it('refuses to follow a symlink that points outside the project root', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-list-dir-symlink-'));
    const outside = await mkdtemp(path.join(tmpdir(), 'dc-list-dir-outside-'));
    cleanup.push(dir, outside);
    await writeFile(path.join(outside, 'SECRET.txt'), 'must stay unreachable\n');
    // A lexical prefix check passes here: the link itself lives inside the root.
    await symlink(outside, path.join(dir, 'escape-link'), 'dir');

    await expect(
      defaultListProjectDirectory({ relativePath: 'escape-link', root: dir }),
    ).rejects.toThrow('outside the project root');
  });

  it('still lists a symlink that stays inside the project root', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-list-dir-inner-link-'));
    cleanup.push(dir);
    await mkdir(path.join(dir, 'real'), { recursive: true });
    await writeFile(path.join(dir, 'real', 'kept.txt'), 'reachable\n');
    await symlink(path.join(dir, 'real'), path.join(dir, 'inner-link'), 'dir');

    const result = await defaultListProjectDirectory({ relativePath: 'inner-link', root: dir });

    // Ids stay anchored to the path the caller asked for, not the link target,
    // so the tree can still attach these rows under the row that was expanded.
    expect(result.entries.map((entry) => entry.relativePath)).toEqual(['inner-link/kept.txt']);
  });
});

describe('defaultSearchProjectFiles', () => {
  it('searches a git repo and returns matching files with ancestor directories', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-search-git-'));
    cleanup.push(dir);
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
    await mkdir(path.join(dir, 'src', 'components'), { recursive: true });
    await writeFile(
      path.join(dir, 'src', 'components', 'Button.tsx'),
      'export const Button = 1;\n',
    );
    await writeFile(path.join(dir, 'src', 'components', 'Input.tsx'), 'export const Input = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });

    const result = await defaultSearchProjectFiles({ query: 'button', scope: dir });

    expect(result.source).toBe('git');
    const relativePaths = result.entries.map((entry) => entry.relativePath);
    expect(relativePaths).toEqual(
      expect.arrayContaining(['src/', 'src/components/', 'src/components/Button.tsx']),
    );
    expect(relativePaths).not.toContain('src/components/Input.tsx');
  });

  it('caps non-git glob search results while preserving matching ancestors', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-search-glob-'));
    cleanup.push(dir);
    await mkdir(path.join(dir, 'nested', 'deep'), { recursive: true });
    await writeFile(path.join(dir, 'nested', 'deep', 'target-file.ts'), 'target\n');
    await writeFile(path.join(dir, 'nested', 'deep', 'other.ts'), 'other\n');

    const result = await defaultSearchProjectFiles({ limit: 1, query: 'target', scope: dir });

    expect(result.source).toBe('glob');
    const relativePaths = result.entries.map((entry) => entry.relativePath);
    expect(relativePaths).toEqual(
      expect.arrayContaining(['nested/', 'nested/deep/', 'nested/deep/target-file.ts']),
    );
    expect(relativePaths).not.toContain('nested/deep/other.ts');
  });

  it('returns matching gitignored files with ignore metadata', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-search-ignored-'));
    cleanup.push(dir);
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: dir });
    await writeFile(path.join(dir, '.gitignore'), '*.local\n');
    await writeFile(path.join(dir, 'secret.local'), 'ignored\n');

    const result = await defaultSearchProjectFiles({ query: 'secret', scope: dir });

    expect(result.entries).toEqual([
      expect.objectContaining({
        gitIgnored: true,
        isDirectory: false,
        relativePath: 'secret.local',
      }),
    ]);
  });

  it('applies eligible-path and ignore filters before truncating search results', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-search-filtered-'));
    cleanup.push(dir);
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: dir });
    await writeFile(path.join(dir, '.gitignore'), '*.local\n');
    await Promise.all(
      Array.from({ length: 201 }, (_, index) =>
        writeFile(path.join(dir, `target-${index.toString().padStart(3, '0')}.ts`), 'target\n'),
      ),
    );
    await writeFile(path.join(dir, 'target-secret.local'), 'ignored\n');
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
    await writeFile(path.join(dir, 'target-200.ts'), 'changed\n');

    const result = await defaultSearchProjectFiles({
      changedOnly: true,
      excludeIgnored: true,
      limit: 1,
      query: 'target',
      scope: dir,
    });

    expect(result.entries.map((entry) => entry.relativePath)).toEqual(['target-200.ts']);
  });

  it('fuzzy-ranks missing eligible paths with indexed files before applying the limit', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-search-deleted-'));
    cleanup.push(dir);
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init'], { cwd: dir });
    await writeFile(path.join(dir, 'button-helper.ts'), 'button\n');
    await writeFile(path.join(dir, 'Button.tsx'), 'button\n');
    await writeFile(path.join(dir, 'ButtonStory.tsx'), 'button\n');
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
    await Promise.all([
      rm(path.join(dir, 'Button.tsx')),
      rm(path.join(dir, 'ButtonStory.tsx')),
      writeFile(path.join(dir, 'button-helper.ts'), 'changed\n'),
    ]);

    const result = await defaultSearchProjectFiles({
      changedOnly: true,
      limit: 2,
      query: 'btn',
      scope: dir,
    });

    const relativePaths = result.entries
      .filter((entry) => !entry.isDirectory)
      .map((entry) => entry.relativePath);
    expect(relativePaths).toHaveLength(2);
    expect(relativePaths).toContain('Button.tsx');
  });

  it('searches hidden project directories in non-git scopes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'dc-search-hidden-'));
    cleanup.push(dir);
    await mkdir(path.join(dir, '.agents', 'skills'), { recursive: true });
    await writeFile(path.join(dir, '.agents', 'skills', 'target-skill.md'), 'skill\n');

    const result = await defaultSearchProjectFiles({ query: 'target-skill', scope: dir });

    const relativePaths = result.entries.map((entry) => entry.relativePath);
    expect(relativePaths).toEqual(
      expect.arrayContaining(['.agents/', '.agents/skills/', '.agents/skills/target-skill.md']),
    );
  });
});
