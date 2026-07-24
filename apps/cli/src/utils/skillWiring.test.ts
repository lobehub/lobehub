import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectClaudeHarness, ensureSkillIgnored, linkHarnessSkills } from './skillWiring';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'skill-wiring-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function gitInit(dir: string) {
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
}

describe('detectClaudeHarness', () => {
  it('detects CLAUDE.md', () => {
    writeFileSync(path.join(root, 'CLAUDE.md'), '# project');
    expect(detectClaudeHarness(root)).toBe(true);
  });

  it('detects an existing .claude directory', () => {
    mkdirSync(path.join(root, '.claude'));
    expect(detectClaudeHarness(root)).toBe(true);
  });

  it('reports no harness when neither exists', () => {
    expect(detectClaudeHarness(root)).toBe(false);
  });
});

describe('linkHarnessSkills', () => {
  it('does nothing when no Claude harness is present', () => {
    expect(linkHarnessSkills(root, 'acceptance')).toEqual({ kind: 'none' });
    expect(existsSync(path.join(root, '.claude'))).toBe(false);
  });

  it('creates a relative .claude/skills symlink onto .agents/skills', () => {
    writeFileSync(path.join(root, 'CLAUDE.md'), '# project');

    const result = linkHarnessSkills(root, 'acceptance');

    expect(result).toEqual({
      kind: 'linked',
      link: path.join('.claude', 'skills'),
      target: path.join('..', '.agents', 'skills'),
    });
    const link = path.join(root, '.claude', 'skills');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(path.join('..', '.agents', 'skills'));
  });

  it('is idempotent when the symlink already points at .agents/skills', () => {
    mkdirSync(path.join(root, '.claude'), { recursive: true });
    symlinkSync(path.join('..', '.agents', 'skills'), path.join(root, '.claude', 'skills'), 'dir');

    expect(linkHarnessSkills(root, 'acceptance')).toEqual({
      kind: 'already',
      link: path.join('.claude', 'skills'),
    });
  });

  it('leaves a symlink pointing somewhere else alone', () => {
    mkdirSync(path.join(root, '.claude'), { recursive: true });
    symlinkSync(path.join('..', 'elsewhere'), path.join(root, '.claude', 'skills'), 'dir');

    const result = linkHarnessSkills(root, 'acceptance');

    expect(result.kind).toBe('skipped');
    expect(readlinkSync(path.join(root, '.claude', 'skills'))).toBe(path.join('..', 'elsewhere'));
  });

  it('links the single skill inside an existing real .claude/skills directory', () => {
    mkdirSync(path.join(root, '.claude', 'skills', 'my-own-skill'), { recursive: true });

    const result = linkHarnessSkills(root, 'acceptance');

    expect(result).toEqual({
      kind: 'linked-single',
      link: path.join('.claude', 'skills', 'acceptance'),
      target: path.join('..', '..', '.agents', 'skills', 'acceptance'),
    });
    expect(existsSync(path.join(root, '.claude', 'skills', 'my-own-skill'))).toBe(true);
  });
});

describe('ensureSkillIgnored', () => {
  it('skips entirely outside a git repository', () => {
    expect(ensureSkillIgnored(root, 'acceptance', false)).toEqual([
      { kind: 'skipped', reason: 'not a git repository' },
    ]);
    expect(existsSync(path.join(root, '.gitignore'))).toBe(false);
  });

  it('records the skill in a nested .agents/skills/.gitignore that also ignores itself', () => {
    gitInit(root);

    const results = ensureSkillIgnored(root, 'acceptance', false);

    expect(results[0]).toMatchObject({ entry: '/acceptance/', kind: 'added' });
    const nested = path.join(root, '.agents', 'skills', '.gitignore');
    expect(readFileSync(nested, 'utf8')).toBe('/.gitignore\n/acceptance/\n');
    expect(existsSync(path.join(root, '.gitignore'))).toBe(false);
  });

  it('leaves git status clean after wiring a fresh project', () => {
    gitInit(root);
    writeFileSync(path.join(root, 'CLAUDE.md'), '# project');
    mkdirSync(path.join(root, '.agents', 'skills', 'acceptance'), { recursive: true });
    writeFileSync(path.join(root, '.agents', 'skills', 'acceptance', 'SKILL.md'), '# skill');

    const link = linkHarnessSkills(root, 'acceptance');
    ensureSkillIgnored(root, 'acceptance', link.kind === 'linked');
    execFileSync('git', ['add', '.gitignore', 'CLAUDE.md'], { cwd: root, stdio: 'ignore' });

    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(status).not.toContain('.agents/skills/.gitignore');
    expect(status).not.toContain('.agents/skills/acceptance');
    expect(status).not.toContain('.claude/skills');
  });

  it('does not seed the self-ignore into a pre-existing nested file', () => {
    gitInit(root);
    mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true });
    writeFileSync(path.join(root, '.agents', 'skills', '.gitignore'), '/legacy/\n');

    ensureSkillIgnored(root, 'acceptance', false);

    expect(readFileSync(path.join(root, '.agents', 'skills', '.gitignore'), 'utf8')).toBe(
      '/legacy/\n/acceptance/\n',
    );
  });

  it('does not duplicate an entry on re-run', () => {
    gitInit(root);
    ensureSkillIgnored(root, 'acceptance', false);

    const results = ensureSkillIgnored(root, 'acceptance', false);

    expect(results[0]).toMatchObject({ entry: '/acceptance/', kind: 'present' });
    expect(readFileSync(path.join(root, '.agents', 'skills', '.gitignore'), 'utf8')).toBe(
      '/.gitignore\n/acceptance/\n',
    );
  });

  it('adds the root .gitignore line when we created the link and git does not ignore it', () => {
    gitInit(root);
    writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');

    ensureSkillIgnored(root, 'acceptance', true);

    expect(readFileSync(path.join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules\n/.claude/skills\n',
    );
  });

  it('leaves the root .gitignore alone when .claude is already ignored', () => {
    gitInit(root);
    writeFileSync(path.join(root, '.gitignore'), '.claude/\n');

    ensureSkillIgnored(root, 'acceptance', true);

    expect(readFileSync(path.join(root, '.gitignore'), 'utf8')).toBe('.claude/\n');
  });

  it('appends a missing trailing newline before the new entry', () => {
    gitInit(root);
    writeFileSync(path.join(root, '.gitignore'), 'node_modules');

    ensureSkillIgnored(root, 'acceptance', true);

    expect(readFileSync(path.join(root, '.gitignore'), 'utf8')).toBe(
      'node_modules\n/.claude/skills\n',
    );
  });
});
