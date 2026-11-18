import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type * as NodeOs from 'node:os';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initWorkspace } from './workspace';

let base: string;
let home: string;

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof NodeOs>()),
  homedir: () => home,
}));

const writeSkill = async (source: string, directory: string, name = directory) => {
  const skillDir = path.join(home, source, 'skills', directory);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${directory} description\n---\nPrivate skill body`,
  );
  return path.join(skillDir, 'SKILL.md');
};

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'device-skill-scan-'));
  home = path.join(base, 'home');
  await mkdir(home, { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(base, { force: true, recursive: true });
});

describe('initWorkspace without a working directory', () => {
  it('discovers all home skill sources without importing home or process-cwd project rules', async () => {
    const agentsPath = await writeSkill('.agents', 'writing');
    const claudePath = await writeSkill('.claude', 'analysis');
    const codexPath = await writeSkill('.codex', 'review');
    await writeFile(path.join(home, 'AGENTS.md'), 'Unselected home instructions');
    await writeFile(path.join(home, 'CLAUDE.md'), 'Unselected home instructions');
    // Even when the daemon starts inside a repository, it is not the user's
    // selected working directory and must not contribute project context.
    const repo = path.join(base, 'repo');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await mkdir(path.join(repo, '.agents', 'skills', 'project-only'), { recursive: true });
    await writeFile(path.join(repo, 'AGENTS.md'), 'Unselected project instructions');
    await writeFile(
      path.join(repo, '.agents', 'skills', 'project-only', 'SKILL.md'),
      '---\nname: project-only\n---\nProject skill body',
    );
    vi.spyOn(process, 'cwd').mockReturnValue(repo);
    const approveProjectRoot = vi.fn<(root: string) => Promise<void>>().mockResolvedValue();

    const result = await initWorkspace({}, { approveProjectRoot });

    expect(result.root).toBeUndefined();
    expect(result.instructions).toEqual([]);
    expect(result.skills.map(({ name, path, scope }) => ({ name, path, scope }))).toEqual([
      { name: 'analysis', path: claudePath, scope: 'device' },
      { name: 'review', path: codexPath, scope: 'device' },
      { name: 'writing', path: agentsPath, scope: 'device' },
    ]);
    expect(JSON.stringify(result)).not.toContain('Private skill body');
    expect(approveProjectRoot.mock.calls.map(([root]) => root).sort()).toEqual(
      ['.agents', '.claude', '.codex'].map((source) => path.join(home, source, 'skills')).sort(),
    );
  });

  it('keeps the existing source priority when device skills share a name', async () => {
    const preferred = await writeSkill('.agents', 'primary', 'shared');
    await writeSkill('.claude', 'secondary', 'shared');
    await writeSkill('.codex', 'last', 'shared');

    const result = await initWorkspace({});

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      description: 'primary description',
      name: 'shared',
      path: preferred,
      scope: 'device',
    });
  });

  it('returns an empty unbound scan when no device skills are installed', async () => {
    const approveProjectRoot = vi.fn<(root: string) => Promise<void>>().mockResolvedValue();

    const result = await initWorkspace({}, { approveProjectRoot });

    expect(result.instructions).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.root).toBeUndefined();
    expect(approveProjectRoot).not.toHaveBeenCalled();
  });
});
