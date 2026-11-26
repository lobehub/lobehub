import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import type * as NodeOs from 'node:os';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { discoverAgentFiles, initWorkspace, listProjectSkills } from '../workspace';

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
  it('keeps a device skill alias when the original name is shadowed by a project skill', async () => {
    const repo = path.join(base, 'repo');
    const projectSkills = path.join(repo, '.agents', 'skills');
    const deviceSkill = path.join(home, '.agents', 'skills', 'foo');
    const alias = path.join(home, '.claude', 'skills', 'bar');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await writeSkill(projectSkills, 'foo');
    await write(path.join(deviceSkill, 'SKILL.md'), '---\ndescription: Device skill\n---\n');
    await mkdir(path.dirname(alias), { recursive: true });
    await symlink(deviceSkill, alias, 'dir');

    const result = await initWorkspace({ scope: repo });

    expect(result.skills).toMatchObject([
      { name: 'bar', path: path.join(alias, 'SKILL.md'), scope: 'device' },
      { name: 'foo', path: path.join(projectSkills, 'foo', 'SKILL.md'), scope: 'project' },
    ]);
  });

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
  it('preserves manual-only declarations without hiding project or device skills', async () => {
    const repo = path.join(base, 'repo');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await write(
      path.join(repo, '.agents/skills/deploy/SKILL.md'),
      '---\nname: deploy\ndisable-model-invocation: true\n---\nDeploy instructions',
    );
    await write(
      path.join(home, '.claude/skills/release/SKILL.md'),
      '---\nname: release\ndisable-model-invocation: true\n---\nRelease instructions',
    );
    await write(
      path.join(home, '.codex/skills/review/SKILL.md'),
      '---\nname: review\ndisable-model-invocation: false\n---\nReview instructions',
    );
    await write(
      path.join(repo, '.claude/skills/context/SKILL.md'),
      '---\nname: context\nuser-invocable: false\n---\nBackground knowledge',
    );
    await write(
      path.join(repo, '.agents/skills/string-value/SKILL.md'),
      '---\nname: string-value\ndisable-model-invocation: "false"\n---\nInvalid boolean',
    );

    const result = await listProjectSkills({ scope: repo });

    expect(result.skills.map((skill) => skill.name)).toEqual([
      'context',
      'deploy',
      'release',
      'review',
      'string-value',
    ]);
    expect(result.skills.filter((skill) => skill.disableModelInvocation)).toMatchObject([
      { name: 'deploy', scope: 'project' },
      { name: 'release', scope: 'device' },
    ]);
  });

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

  it('deduplicates symlinked skills pointing to the same physical SKILL.md via realpath', async () => {
    const repo = path.join(base, 'repo');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    // Physical skill without frontmatter `name`, so directory name would otherwise decide `name`
    const targetDir = path.join(repo, '.agents', 'skills', 'shared-skill');
    await write(path.join(targetDir, 'SKILL.md'), '---\ndescription: Shared physical skill\n---\n');

    // Symlink in .claude/skills under a different directory name and in home .codex/skills
    await mkdir(path.join(repo, '.claude', 'skills'), { recursive: true });
    await symlink(targetDir, path.join(repo, '.claude', 'skills', 'claude-alias'), 'dir');
    await mkdir(path.join(home, '.codex', 'skills'), { recursive: true });
    await symlink(targetDir, path.join(home, '.codex', 'skills', 'codex-alias'), 'dir');

    const result = await initWorkspace({ scope: repo });

    expect(result.skills).toMatchObject([
      {
        description: 'Shared physical skill',
        disableModelInvocation: false,
        name: 'shared-skill',
        path: path.join(targetDir, 'SKILL.md'),
        previewRoot: repo,
        scope: 'project',
        skillDir: targetDir,
        source: '.agents/skills',
      },
    ]);
  });

  it('stops at SKILL.md without traversing subdirectories inside a skill directory', async () => {
    const repo = path.join(base, 'repo');
    const skillDir = path.join(repo, '.agents', 'skills', 'lobe-design');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await writeSkill(path.join(repo, '.agents', 'skills'), 'lobe-design');
    await write(path.join(skillDir, 'references', 'rules.md'), '# rules');
    await write(path.join(skillDir, 'scripts', 'route.mjs'), 'export default {}');

    const result = await listProjectSkills({ scope: repo });

    expect(result.skills).toEqual([
      {
        description: 'lobe-design skill',
        disableModelInvocation: false,
        name: 'lobe-design',
        path: path.join(skillDir, 'SKILL.md'),
        previewRoot: repo,
        scope: 'project',
        skillDir,
        source: '.agents/skills',
      },
    ]);
  });
});

describe('discoverAgentFiles', () => {
  let repo: string;

  beforeEach(async () => {
    // Discovery compares real paths; the OS temp dir is a symlink on macOS.
    base = await realpath(base);
    home = path.join(base, 'home');
    repo = path.join(base, 'repo');
    await mkdir(path.join(repo, '.git'), { recursive: true });
    await write(path.join(repo, 'AGENTS.md'), 'root rules');
  });

  it('finds a package’s agent files the first time the run touches it', async () => {
    const pkg = path.join(repo, 'packages', 'web');
    await write(path.join(pkg, 'AGENTS.md'), 'web rules');
    await write(path.join(pkg, 'src', 'app.ts'), '');
    await writeSkill(path.join(pkg, '.agents', 'skills'), 'web-design');

    const result = await discoverAgentFiles({
      knownDirs: [repo],
      path: path.join(pkg, 'src', 'app.ts'),
      root: repo,
    });

    expect(result).toMatchObject({
      dirs: [path.join(pkg, 'src'), pkg, path.join(repo, 'packages')],
      instructions: [{ content: 'web rules', path: path.join(pkg, 'AGENTS.md') }],
      outcome: 'found',
      skills: [{ name: 'web-design', scope: 'project' }],
    });
  });

  // `~/…` goes through the same `resolveAgainstCwd` as the file tools.
  it('resolves a relative path the way the file tool does', async () => {
    const pkg = path.join(repo, 'pkg');
    await write(path.join(pkg, 'AGENTS.md'), 'pkg rules');

    const relative = await discoverAgentFiles({
      cwd: repo,
      knownDirs: [repo],
      path: 'pkg/a.ts',
      root: repo,
    });
    expect(relative.dirs).toEqual([pkg]);
    expect(relative.instructions.map((item) => item.content)).toEqual(['pkg rules']);
  });

  it('reads nothing outside the working directory', async () => {
    const other = path.join(base, 'other');
    await mkdir(path.join(other, '.git'), { recursive: true });
    await write(path.join(other, 'AGENTS.md'), 'other rules');

    const result = await discoverAgentFiles({
      knownDirs: [repo],
      path: path.join(other, 'a.ts'),
      root: repo,
    });

    expect(result).toMatchObject({ dirs: [], instructions: [], outcome: 'outside-root' });
  });

  it('does not follow a symlink out of the working directory', async () => {
    const other = path.join(base, 'other');
    await write(path.join(other, 'AGENTS.md'), 'other rules');
    await symlink(other, path.join(repo, 'linked'));

    const result = await discoverAgentFiles({
      knownDirs: [repo],
      path: path.join(repo, 'linked', 'a.ts'),
      root: repo,
    });

    expect(result).toMatchObject({ instructions: [], outcome: 'outside-root' });
  });

  it('returns nothing to walk inside a known directory', async () => {
    const result = await discoverAgentFiles({
      knownDirs: [repo],
      path: path.join(repo, 'README.md'),
      root: repo,
    });

    expect(result).toMatchObject({ dirs: [], instructions: [], outcome: 'empty', skills: [] });
  });

  it('uses the parent of a file that does not exist yet', async () => {
    const result = await discoverAgentFiles({
      path: path.join(repo, 'new', 'file.ts'),
      root: repo,
    });

    expect(result.dirs).toEqual([path.join(repo, 'new'), repo]);
    expect(result.instructions.map((item) => item.content)).toEqual(['root rules']);
  });

  it('reads at most 50 skills', async () => {
    const skills = path.join(repo, 'pkg', '.agents', 'skills');
    await Promise.all(
      Array.from({ length: 60 }, (_, index) =>
        writeSkill(skills, `skill-${String(index).padStart(2, '0')}`),
      ),
    );

    const result = await discoverAgentFiles({
      knownDirs: [repo],
      path: path.join(repo, 'pkg', 'a.ts'),
      root: repo,
    });

    expect(result.skills).toHaveLength(50);
  });
});
