import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerArtboardCommand } from './artboard';
import { ARTBOARD_SKILL_ID } from './artboardSkill';

const { output, version } = vi.hoisted(() => ({ output: vi.fn(), version: { value: '1.4.0' } }));
vi.mock('../pkg', () => ({
  get cliVersion() {
    return version.value;
  },
}));
vi.mock('../api/client', () => ({ getTrpcClient: vi.fn() }));
vi.mock('../utils/format', () => ({ outputJson: output }));

const run = async (...args: string[]) => {
  const program = new Command().exitOverride();
  registerArtboardCommand(program);
  await program.parseAsync(['node', 'lh', 'artboard', 'skill', 'init', ...args]);
};

describe('lh artboard skill init', () => {
  let directory: string;
  const skillPath = (...parts: string[]) =>
    path.join(directory, '.agents', 'skills', ARTBOARD_SKILL_ID, ...parts);

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'artboard-skill-'));
    version.value = '1.4.0';
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    output.mockReset();
    await rm(directory, { force: true, recursive: true });
  });

  it('writes the skill with the version of the CLI that wrote it', async () => {
    await run('--dir', directory);

    const skill = await readFile(skillPath('SKILL.md'), 'utf8');
    expect(skill).toMatch(/^---\nname: lobehub-artboard\ndescription: ".+"\n/);
    expect(skill).toContain('metadata:\n  version: "1.4.0"\n---\n');
  });

  it('links the skill for a harness that does not read .agents/skills', async () => {
    await writeFile(path.join(directory, 'CLAUDE.md'), '');

    await run('--dir', directory);

    expect(await readlink(path.join(directory, '.claude', 'skills'))).toBe(
      path.join('..', '.agents', 'skills'),
    );
  });

  it('replaces an edited skill and removes files the current version does not have', async () => {
    await run('--dir', directory);
    const written = await readFile(skillPath('SKILL.md'), 'utf8');
    await writeFile(skillPath('SKILL.md'), written.replace(/\n[^\n]+\n$/, '\nedited by hand\n'));
    await mkdir(skillPath('references'), { recursive: true });
    await writeFile(skillPath('references', 'old.md'), 'stale');

    await run('--dir', directory, '--json');

    expect(await readFile(skillPath('SKILL.md'), 'utf8')).toBe(written);
    await expect(readFile(skillPath('references', 'old.md'), 'utf8')).rejects.toThrow();
    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({
        removed: ['references/old.md'],
        status: 'installed',
        version: '1.4.0',
        written: ['SKILL.md'],
      }),
    );
  });

  it('leaves a skill written by a newer CLI alone', async () => {
    version.value = '1.10.0';
    await run('--dir', directory);
    const newer = await readFile(skillPath('SKILL.md'), 'utf8');
    version.value = '1.9.3';

    await run('--dir', directory, '--json');

    expect(await readFile(skillPath('SKILL.md'), 'utf8')).toBe(newer);
    expect(output).toHaveBeenLastCalledWith(
      expect.objectContaining({
        installedVersion: '1.10.0',
        status: 'newer-installed',
        version: '1.9.3',
        written: [],
      }),
    );
  });

  it('still sees the installed version after a formatter rewrote the frontmatter', async () => {
    version.value = '1.10.0';
    await run('--dir', directory);
    const reformatted = (await readFile(skillPath('SKILL.md'), 'utf8')).replace(
      '  version: "1.10.0"',
      "    version: '1.10.0'",
    );
    await writeFile(skillPath('SKILL.md'), reformatted);
    version.value = '1.9.3';

    await run('--dir', directory, '--json');

    expect(await readFile(skillPath('SKILL.md'), 'utf8')).toBe(reformatted);
    expect(output).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'newer-installed' }));
  });

  it('removes nothing when the skill directory is a link to somewhere else', async () => {
    const elsewhere = path.join(directory, 'elsewhere');
    await mkdir(elsewhere);
    await writeFile(path.join(elsewhere, 'keep.md'), 'not ours');
    await mkdir(path.join(directory, '.agents', 'skills'), { recursive: true });
    await symlink(elsewhere, skillPath());

    await expect(run('--dir', directory)).rejects.toThrow(/symbolic link/);

    expect(await readFile(path.join(elsewhere, 'keep.md'), 'utf8')).toBe('not ours');
  });

  it('says that a decision board takes no acceptance check', async () => {
    await run('--dir', directory);

    expect(await readFile(skillPath('SKILL.md'), 'utf8')).toMatch(
      /decision board[^.]*\bno(ne)?\b/i,
    );
  });

  it('touches nothing outside the skill directory and the harness links', async () => {
    await writeFile(path.join(directory, '.gitignore'), 'node_modules\n');

    await run('--dir', directory);

    expect(await readFile(path.join(directory, '.gitignore'), 'utf8')).toBe('node_modules\n');
  });

  it('names no artboard command the CLI lacks', async () => {
    await run('--dir', directory);

    const skill = await readFile(skillPath('SKILL.md'), 'utf8');
    expect(skill).toContain('lh man artboard');
    expect(skill).toContain('lh artboard ops');
    expect(skill).not.toMatch(/lh artboard (?!create|update|read|list|ops|--help|skill)[a-z]/);
    expect(skill).not.toMatch(/listArtboardComments|replyArtboardComment|askArtboardQuestion/);
  });
});
