import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listClaudeCodeMemory,
  resolveClaudeCodeMemoryDir,
  resolveClaudeCodeProjectRoot,
  toClaudeCodeProjectKey,
} from '../claudeCodeMemory';

let sandbox: string;
let home: string;
let managedSettingsDir: string;

const memoryEnv = (env: NodeJS.ProcessEnv = {}) => ({ env, homedir: home, managedSettingsDir });

const write = async (filePath: string, content: string) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
};

beforeEach(async () => {
  sandbox = await realpath(await mkdtemp(path.join(tmpdir(), 'cc-memory-')));
  home = path.join(sandbox, 'home');
  managedSettingsDir = path.join(sandbox, 'managed');
  await mkdir(home, { recursive: true });
});

afterEach(async () => {
  await rm(sandbox, { force: true, recursive: true });
});

describe('toClaudeCodeProjectKey', () => {
  it('replaces every non-alphanumeric character with a dash', () => {
    expect(toClaudeCodeProjectKey('/home/ubuntu/develop/amazing/lobehub')).toBe(
      '-home-ubuntu-develop-amazing-lobehub',
    );
    expect(toClaudeCodeProjectKey('C:\\Users\\me\\my_app.v2')).toBe('C--Users-me-my-app-v2');
  });

  it('caps long keys at 200 characters and appends a hash of the full path', () => {
    const longPath = `/${'a'.repeat(250)}`;
    const key = toClaudeCodeProjectKey(longPath);

    expect(key.startsWith(`-${'a'.repeat(199)}-`)).toBe(true);
    expect(key).toMatch(/^-a{199}-[\da-z]+$/);
    expect(toClaudeCodeProjectKey(`/${'a'.repeat(251)}`)).not.toBe(key);
  });

  it('keys the NFC form, so a decomposed macOS path maps to the same directory', () => {
    const composed = '/Users/me/caf\u00E9';
    const decomposed = '/Users/me/cafe\u0301';

    expect(toClaudeCodeProjectKey(decomposed)).toBe(toClaudeCodeProjectKey(composed));
    expect(toClaudeCodeProjectKey(`/${'\u00E9'.repeat(250)}`)).toBe(
      toClaudeCodeProjectKey(`/${'e\u0301'.repeat(250)}`),
    );
  });
});

describe('resolveClaudeCodeProjectRoot', () => {
  it('uses the git root for a subdirectory of a repository', async () => {
    const repo = path.join(sandbox, 'repo');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await mkdir(path.join(repo, 'packages', 'app'), { recursive: true });

    expect(await resolveClaudeCodeProjectRoot(path.join(repo, 'packages', 'app'))).toBe(repo);
  });

  it('maps a linked worktree back to the main checkout', async () => {
    const repo = path.join(sandbox, 'repo');
    const worktree = path.join(sandbox, 'repo-wt');
    const worktreeGitDir = path.join(repo, '.git', 'worktrees', 'repo-wt');
    await write(path.join(worktreeGitDir, 'commondir'), '../..\n');
    await write(path.join(worktree, '.git'), `gitdir: ${worktreeGitDir}\n`);

    expect(await resolveClaudeCodeProjectRoot(worktree)).toBe(repo);
  });

  it('keeps a submodule checkout as its own root', async () => {
    const submodule = path.join(sandbox, 'repo', 'vendor', 'lib');
    await mkdir(path.join(sandbox, 'repo', '.git', 'modules', 'lib'), { recursive: true });
    await write(path.join(submodule, '.git'), 'gitdir: ../../.git/modules/lib\n');

    expect(await resolveClaudeCodeProjectRoot(submodule)).toBe(submodule);
  });

  it('falls back to the directory itself outside git', async () => {
    const dir = path.join(sandbox, 'plain');
    await mkdir(dir, { recursive: true });

    expect(await resolveClaudeCodeProjectRoot(dir)).toBe(dir);
  });
});

describe('resolveClaudeCodeMemoryDir', () => {
  let dir: string;

  beforeEach(async () => {
    dir = path.join(sandbox, 'plain');
    await mkdir(dir, { recursive: true });
  });

  it('defaults to ~/.claude/projects/<key>/memory', async () => {
    expect(await resolveClaudeCodeMemoryDir(dir, memoryEnv())).toBe(
      path.join(home, '.claude', 'projects', toClaudeCodeProjectKey(dir), 'memory'),
    );
  });

  it('honors CLAUDE_CONFIG_DIR', async () => {
    const configDir = path.join(sandbox, 'cc-config');

    expect(await resolveClaudeCodeMemoryDir(dir, memoryEnv({ CLAUDE_CONFIG_DIR: configDir }))).toBe(
      path.join(configDir, 'projects', toClaudeCodeProjectKey(dir), 'memory'),
    );
  });

  it('uses CLAUDE_CODE_PROJECT_DIR_NAME as the key only beside CLAUDE_CONFIG_DIR', async () => {
    const configDir = path.join(sandbox, 'cc-config');
    const derived = toClaudeCodeProjectKey(dir);

    expect(
      await resolveClaudeCodeMemoryDir(
        dir,
        memoryEnv({ CLAUDE_CODE_PROJECT_DIR_NAME: 'work', CLAUDE_CONFIG_DIR: configDir }),
      ),
    ).toBe(path.join(configDir, 'projects', 'work', 'memory'));
    expect(
      await resolveClaudeCodeMemoryDir(dir, memoryEnv({ CLAUDE_CODE_PROJECT_DIR_NAME: 'work' })),
    ).toBe(path.join(home, '.claude', 'projects', derived, 'memory'));

    for (const invalid of ['con', 'a/b', 'x'.repeat(65)]) {
      expect(
        await resolveClaudeCodeMemoryDir(
          dir,
          memoryEnv({ CLAUDE_CODE_PROJECT_DIR_NAME: invalid, CLAUDE_CONFIG_DIR: configDir }),
        ),
      ).toBe(path.join(configDir, 'projects', derived, 'memory'));
    }
  });

  it('honors autoMemoryDirectory from user settings', async () => {
    await write(
      path.join(home, '.claude', 'settings.json'),
      JSON.stringify({ autoMemoryDirectory: '~/notes/cc-memory' }),
    );

    expect(await resolveClaudeCodeMemoryDir(dir, memoryEnv())).toBe(
      path.join(home, 'notes', 'cc-memory'),
    );
  });

  it('takes autoMemoryDirectory from the winning scope: managed, local, project, then user', async () => {
    const repo = path.join(sandbox, 'repo');
    const cwd = path.join(repo, 'packages', 'app');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    const setMemoryDir = (file: string, value: string) =>
      write(file, JSON.stringify({ autoMemoryDirectory: value }));
    const resolve = () => resolveClaudeCodeMemoryDir(cwd, memoryEnv());

    await setMemoryDir(path.join(home, '.claude', 'settings.json'), '/scopes/user');
    expect(await resolve()).toBe(path.resolve('/scopes/user'));

    await setMemoryDir(path.join(cwd, '.claude', 'settings.json'), '/scopes/project');
    expect(await resolve()).toBe(path.resolve('/scopes/project'));

    await setMemoryDir(path.join(cwd, '.claude', 'settings.local.json'), '/scopes/legacy-local');
    expect(await resolve()).toBe(path.resolve('/scopes/legacy-local'));

    await setMemoryDir(path.join(repo, '.claude', 'settings.local.json'), '/scopes/local');
    expect(await resolve()).toBe(path.resolve('/scopes/local'));

    await setMemoryDir(path.join(managedSettingsDir, 'managed-settings.json'), '/scopes/managed');
    await setMemoryDir(
      path.join(managedSettingsDir, 'managed-settings.d', '10-memory.json'),
      '/scopes/drop-in',
    );
    await write(path.join(managedSettingsDir, 'managed-settings.d', '20-other.json'), '{}');
    expect(await resolve()).toBe(path.resolve('/scopes/drop-in'));
  });

  it('ignores an autoMemoryDirectory that is neither absolute nor under ~/', async () => {
    await write(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({ autoMemoryDirectory: 'relative/memory' }),
    );

    expect(await resolveClaudeCodeMemoryDir(dir, memoryEnv())).toBe(
      path.join(home, '.claude', 'projects', toClaudeCodeProjectKey(dir), 'memory'),
    );
  });
});

describe('listClaudeCodeMemory', () => {
  const memoryDirFor = (dir: string) =>
    path.join(home, '.claude', 'projects', toClaudeCodeProjectKey(dir), 'memory');

  it('returns an empty list without approving anything when no memory exists', async () => {
    const dir = path.join(sandbox, 'plain');
    await mkdir(dir, { recursive: true });
    const approveProjectRoot = vi.fn(async () => {});

    const result = await listClaudeCodeMemory({ scope: dir }, { approveProjectRoot }, memoryEnv());

    expect(result).toEqual({ files: [], memoryDir: memoryDirFor(dir) });
    expect(approveProjectRoot).not.toHaveBeenCalled();
  });

  it('lists the index first, parses frontmatter and approves the memory directory', async () => {
    const dir = path.join(sandbox, 'plain');
    await mkdir(dir, { recursive: true });
    const memoryDir = memoryDirFor(dir);
    await write(path.join(memoryDir, 'MEMORY.md'), '- [Testing](testing.md) — hook\n');
    await write(
      path.join(memoryDir, 'testing.md'),
      [
        '---',
        'name: testing-rules',
        'description: Run focused vitest only',
        'metadata:',
        '  type: feedback',
        '---',
        'Never run the full suite.',
      ].join('\n'),
    );
    await write(path.join(memoryDir, 'about.md'), '---\ntype: user\n---\nA backend engineer.');
    await write(path.join(memoryDir, 'notes.txt'), 'ignored');
    await write(path.join(memoryDir, '.draft.md'), 'ignored');
    const approveProjectRoot = vi.fn(async () => {});

    const result = await listClaudeCodeMemory({ scope: dir }, { approveProjectRoot }, memoryEnv());

    expect(result.memoryDir).toBe(memoryDir);
    expect(result.files.map((file) => file.relativePath)).toEqual([
      'MEMORY.md',
      'about.md',
      'testing.md',
    ]);
    expect(result.files[0]).toMatchObject({ isIndex: true, name: 'MEMORY' });
    expect(result.files[1]).toMatchObject({ isIndex: false, name: 'about', type: 'user' });
    expect(result.files[2]).toMatchObject({
      description: 'Run focused vitest only',
      name: 'testing-rules',
      path: path.join(memoryDir, 'testing.md'),
      type: 'feedback',
    });
    expect(approveProjectRoot).toHaveBeenCalledWith(memoryDir);
  });

  it("reads the agent's own CLAUDE_CONFIG_DIR over the device's", async () => {
    const dir = path.join(sandbox, 'plain');
    const agentConfigDir = path.join(sandbox, 'agent-config');
    await mkdir(dir, { recursive: true });
    const memoryDir = path.join(agentConfigDir, 'projects', toClaudeCodeProjectKey(dir), 'memory');
    await write(path.join(memoryDir, 'MEMORY.md'), '- index\n');

    const result = await listClaudeCodeMemory(
      { env: { CLAUDE_CONFIG_DIR: agentConfigDir }, scope: dir },
      {},
      memoryEnv({ CLAUDE_CONFIG_DIR: path.join(sandbox, 'device-config') }),
    );

    expect(result.memoryDir).toBe(memoryDir);
    expect(result.files.map((file) => file.relativePath)).toEqual(['MEMORY.md']);
  });

  it('never approves a memory directory that contains the project', async () => {
    const dir = path.join(home, 'projects', 'repo');
    await mkdir(dir, { recursive: true });
    await write(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({ autoMemoryDirectory: '~/' }),
    );
    await write(path.join(home, 'notes.md'), 'personal notes');
    const approveProjectRoot = vi.fn(async () => {});

    const result = await listClaudeCodeMemory({ scope: dir }, { approveProjectRoot }, memoryEnv());

    expect(result.memoryDir).toBe(home);
    expect(result.files.length).toBeGreaterThan(0);
    expect(approveProjectRoot).not.toHaveBeenCalled();
  });
});
