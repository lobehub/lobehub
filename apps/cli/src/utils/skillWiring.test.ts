import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectClaudeHarness, linkHarnessSkills } from './skillWiring';

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

describe('install wiring never writes .gitignore', () => {
  // The materialized acceptance skill is checked into the consuming repo, so
  // wiring must leave every ignore file untouched — an ignored skill dir would
  // silently keep it out of review.
  it('leaves the repo without any generated ignore entry', () => {
    gitInit(root);
    writeFileSync(path.join(root, 'CLAUDE.md'), '# project');
    mkdirSync(path.join(root, '.agents', 'skills', 'acceptance'), { recursive: true });
    writeFileSync(path.join(root, '.agents', 'skills', 'acceptance', 'SKILL.md'), '# skill');

    linkHarnessSkills(root, 'acceptance');

    expect(existsSync(path.join(root, '.gitignore'))).toBe(false);
    expect(existsSync(path.join(root, '.agents', 'skills', '.gitignore'))).toBe(false);

    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(status).toContain('.agents/skills/acceptance/SKILL.md');
  });
});
