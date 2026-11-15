import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import type * as NodeOs from 'node:os';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initWorkspace, listProjectSkills } from '../workspace';

let base: string;
let home: string;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeOs>();
  return { ...actual, homedir: () => home };
});

const write = async (file: string, content: string) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
};

const writeSkill = (dir: string, name: string, description = `${name} skill`) =>
  write(
    path.join(dir, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  );

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'workspace-scan-'));
  home = path.join(base, 'home');
  await mkdir(home, { recursive: true });
});

afterEach(async () => {
  await rm(base, { force: true, recursive: true });
});

describe('initWorkspace', () => {
  it('reads instructions from the working directory up to the repository root, root first', async () => {
    const repo = path.join(base, 'outside', 'repo');
    const pkg = path.join(repo, 'packages', 'web');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await write(path.join(base, 'outside', 'AGENTS.md'), 'above the repository');
    await write(path.join(repo, 'AGENTS.md'), 'repo rules');
    await write(path.join(pkg, 'AGENTS.md'), 'web rules');

    const result = await initWorkspace({ scope: pkg });

    expect(result.instructions).toEqual([
      { content: 'repo rules', path: path.join(repo, 'AGENTS.md'), source: 'AGENTS.md' },
      { content: 'web rules', path: path.join(pkg, 'AGENTS.md'), source: 'AGENTS.md' },
    ]);
  });

  it('stops at a .git file, as in a worktree or submodule', async () => {
    const outer = path.join(base, 'outer');
    const submodule = path.join(outer, 'sub');
    await mkdir(path.join(outer, '.git'), { recursive: true });
    await write(path.join(submodule, '.git'), 'gitdir: ../.git/modules/sub');
    await write(path.join(outer, 'AGENTS.md'), 'outer rules');
    await write(path.join(submodule, 'AGENTS.md'), 'sub rules');

    const result = await initWorkspace({ scope: submodule });

    expect(result.instructions.map((item) => item.content)).toEqual(['sub rules']);
  });

  it('reads only the working directory outside a repository', async () => {
    const dir = path.join(base, 'plain', 'dir');
    await write(path.join(base, 'plain', 'AGENTS.md'), 'parent rules');
    await write(path.join(dir, 'AGENTS.md'), 'dir rules');

    const result = await initWorkspace({ scope: dir });

    expect(result.instructions.map((item) => item.content)).toEqual(['dir rules']);
  });

  it('injects a CLAUDE.md symlinked to AGENTS.md once', async () => {
    const repo = path.join(base, 'repo');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await write(path.join(repo, 'AGENTS.md'), 'shared rules');
    await symlink('AGENTS.md', path.join(repo, 'CLAUDE.md'));

    const result = await initWorkspace({ scope: repo });

    expect(result.instructions).toEqual([
      { content: 'shared rules', path: path.join(repo, 'AGENTS.md'), source: 'AGENTS.md' },
    ]);
  });

  it('keeps the nearest files when the total budget runs out', async () => {
    const repo = path.join(base, 'repo');
    const pkg = path.join(repo, 'pkg');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await write(path.join(repo, 'AGENTS.md'), 'r'.repeat(70 * 1024));
    await write(path.join(pkg, 'AGENTS.md'), 'a'.repeat(70 * 1024));
    await write(path.join(pkg, 'CLAUDE.md'), 'c'.repeat(70 * 1024));

    const result = await initWorkspace({ scope: pkg });

    expect(result.instructions.map((item) => [item.path, item.content.length])).toEqual([
      [path.join(pkg, 'AGENTS.md'), 64 * 1024],
      [path.join(pkg, 'CLAUDE.md'), 64 * 1024],
    ]);
  });

  it('counts the budget in UTF-8 bytes, not characters', async () => {
    const repo = path.join(base, 'repo');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    // 3 bytes per character in UTF-8: 30,000 characters is ~88KB.
    await write(path.join(repo, 'AGENTS.md'), '规'.repeat(30_000));

    const result = await initWorkspace({ scope: repo });

    const [file] = result.instructions;
    expect(Buffer.byteLength(file.content, 'utf8')).toBeLessThanOrEqual(64 * 1024);
    expect(file.content).toBe('规'.repeat(Math.floor((64 * 1024) / 3)));
  });

  it('discovers skills in parent directories and .codex/skills, nearest first', async () => {
    const repo = path.join(base, 'repo');
    const pkg = path.join(repo, 'packages', 'web');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await writeSkill(path.join(pkg, '.claude', 'skills'), 'deploy', 'web deploy');
    await writeSkill(path.join(repo, '.agents', 'skills'), 'deploy', 'root deploy');
    await writeSkill(path.join(repo, '.codex', 'skills'), 'review');
    await writeSkill(path.join(home, '.codex', 'skills'), 'personal');
    await writeSkill(path.join(home, '.agents', 'skills'), 'review', 'device review');

    const result = await initWorkspace({ scope: pkg });

    expect(
      result.skills.map(({ description, name, previewRoot, scope, source }) => ({
        description,
        name,
        previewRoot,
        scope,
        source,
      })),
    ).toEqual([
      {
        description: 'web deploy',
        name: 'deploy',
        previewRoot: pkg,
        scope: 'project',
        source: '.claude/skills',
      },
      {
        description: 'personal skill',
        name: 'personal',
        previewRoot: path.join(home, '.codex', 'skills'),
        scope: 'device',
        source: '.codex/skills',
      },
      {
        description: 'review skill',
        name: 'review',
        previewRoot: path.join(repo, '.codex', 'skills'),
        scope: 'project',
        source: '.codex/skills',
      },
    ]);
  });
});

describe('listProjectSkills', () => {
  it('approves the source directory of a parent-level skill for preview', async () => {
    const repo = path.join(base, 'repo');
    const pkg = path.join(repo, 'pkg');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await mkdir(pkg, { recursive: true });
    await writeSkill(path.join(repo, '.agents', 'skills'), 'lint');
    const approveProjectRoot = vi.fn(async () => {});

    const result = await listProjectSkills({ scope: pkg }, { approveProjectRoot });

    expect(result.skills.map((skill) => skill.path)).toEqual([
      path.join(repo, '.agents', 'skills', 'lint', 'SKILL.md'),
    ]);
    expect(approveProjectRoot).toHaveBeenCalledWith(path.join(repo, '.agents', 'skills'));
  });
});
