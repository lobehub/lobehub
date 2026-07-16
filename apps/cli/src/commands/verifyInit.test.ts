import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HARNESS_SKILL_DIRS,
  isVerifyInitSuccess,
  NoHarnessDirError,
  runVerifyInit,
} from './verifyInit';

const { mockLocateBundledSkill } = vi.hoisted(() => ({
  mockLocateBundledSkill: vi.fn(),
}));
vi.mock('../utils/skillLocator', () => ({ locateBundledSkill: mockLocateBundledSkill }));

let root: string;
let bundleDir: string;

function writeBundledSkill(dir: string) {
  mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), '# agent-testing');
  writeFileSync(path.join(dir, 'scripts', 'run.sh'), '#!/bin/sh\necho hi\n');
  writeFileSync(path.join(dir, 'scripts', 'analyze.mjs'), 'console.log(1)');
  writeFileSync(path.join(dir, 'scripts', 'note.txt'), 'not executable');
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'verify-init-'));
  bundleDir = path.join(root, '__bundle__', 'agent-testing');
  writeBundledSkill(bundleDir);
  mockLocateBundledSkill.mockReset().mockReturnValue({
    cliRoot: path.join(root, '__bundle__'),
    skillDir: bundleDir,
    version: '1.0.0',
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeCwd(): string {
  const cwd = mkdtempSync(path.join(root, 'consumer-'));
  return cwd;
}

describe('runVerifyInit — no harness dir found', () => {
  it('throws NoHarnessDirError listing recognized dirs, without --target', () => {
    const cwd = makeCwd();
    expect(() => runVerifyInit({ cwd })).toThrow(NoHarnessDirError);
    try {
      runVerifyInit({ cwd });
    } catch (e) {
      expect((e as Error).message).toContain('.claude/skills');
      expect((e as Error).message).toContain('.codex/skills');
      expect((e as Error).message).toContain('.agents/skills');
      expect((e as Error).message).toContain('--target');
    }
  });
});

describe('runVerifyInit — fresh install', () => {
  it('installs into a single existing harness dir', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });

    const result = runVerifyInit({ cwd });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe('installed');
    const target = path.join(cwd, '.claude', 'skills', 'agent-testing');
    expect(result.results[0].target).toBe(target);
    expect(readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# agent-testing');

    const meta = JSON.parse(readFileSync(path.join(target, '.skill-meta.json'), 'utf8'));
    expect(meta).toEqual({
      cliRoot: path.join(root, '__bundle__'),
      name: 'agent-testing',
      version: '1.0.0',
    });
  });

  it('installs into every existing harness dir (multi-harness)', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    mkdirSync(path.join(cwd, '.codex', 'skills'), { recursive: true });
    // .agents/skills intentionally absent

    const result = runVerifyInit({ cwd });

    expect(result.results.map((r) => r.status)).toEqual(['installed', 'installed']);
    expect(result.results.map((r) => r.target).sort()).toEqual(
      [
        path.join(cwd, '.claude', 'skills', 'agent-testing'),
        path.join(cwd, '.codex', 'skills', 'agent-testing'),
      ].sort(),
    );
  });

  it('re-applies chmod +x to .sh/.mjs/.cjs after copying, leaves other files untouched', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    const result = runVerifyInit({ cwd });
    const target = result.results[0].target;

    const shMode = statSync(path.join(target, 'scripts', 'run.sh')).mode & 0o777;
    const mjsMode = statSync(path.join(target, 'scripts', 'analyze.mjs')).mode & 0o777;
    expect(shMode & 0o111).toBe(0o111);
    expect(mjsMode & 0o111).toBe(0o111);
  });

  it('respects --target, creating the dir if missing, and does not touch harness dirs', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true }); // present but must be ignored

    const result = runVerifyInit({ cwd, target: 'custom/skills-dir' });

    expect(result.results).toHaveLength(1);
    const target = path.join(cwd, 'custom', 'skills-dir', 'agent-testing');
    expect(result.results[0].target).toBe(target);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(path.join(cwd, '.claude', 'skills', 'agent-testing'))).toBe(false);
  });
});

describe('runVerifyInit — edge cases', () => {
  it('version marker present, bundled version newer → overwrites skill body', () => {
    const cwd = makeCwd();
    const skillsDir = path.join(cwd, '.claude', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    runVerifyInit({ cwd }); // installs 1.0.0

    mockLocateBundledSkill.mockReturnValue({
      cliRoot: path.join(root, '__bundle__'),
      skillDir: bundleDir,
      version: '2.0.0',
    });
    writeFileSync(path.join(bundleDir, 'SKILL.md'), '# agent-testing v2');

    const result = runVerifyInit({ cwd });
    expect(result.results[0].status).toBe('updated');
    const target = path.join(skillsDir, 'agent-testing');
    expect(readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# agent-testing v2');
    const meta = JSON.parse(readFileSync(path.join(target, '.skill-meta.json'), 'utf8'));
    expect(meta.version).toBe('2.0.0');
  });

  it('marker present, same version → no-op with message', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    runVerifyInit({ cwd });

    const result = runVerifyInit({ cwd });
    expect(result.results[0].status).toBe('no-op');
  });

  it('marker present, bundled version older → no-op with message', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    mockLocateBundledSkill.mockReturnValue({
      cliRoot: path.join(root, '__bundle__'),
      skillDir: bundleDir,
      version: '5.0.0',
    });
    runVerifyInit({ cwd }); // installs 5.0.0

    mockLocateBundledSkill.mockReturnValue({
      cliRoot: path.join(root, '__bundle__'),
      skillDir: bundleDir,
      version: '1.0.0',
    });
    const result = runVerifyInit({ cwd });
    expect(result.results[0].status).toBe('no-op');
  });

  it('target agent-testing dir exists WITHOUT marker → refuses; --force replaces', () => {
    const cwd = makeCwd();
    const skillsDir = path.join(cwd, '.claude', 'skills');
    const target = path.join(skillsDir, 'agent-testing');
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'SKILL.md'), '# hand-written predecessor');

    const refused = runVerifyInit({ cwd });
    expect(refused.results[0].status).toBe('refused');
    expect(readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# hand-written predecessor');

    const forced = runVerifyInit({ cwd, force: true });
    expect(forced.results[0].status).toBe('updated');
    expect(readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# agent-testing');
  });

  it('consumer cwd not a git repo → installs anyway, reports isGitRepo: false', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    const result = runVerifyInit({ cwd });
    expect(result.isGitRepo).toBe(false);
    expect(result.results[0].status).toBe('installed');
  });

  it('cwd is a git repo → reports isGitRepo: true', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    mkdirSync(path.join(cwd, '.git'), { recursive: true });
    const result = runVerifyInit({ cwd });
    expect(result.isGitRepo).toBe(true);
  });

  it('no .gitignore at cwd → creates one containing .records/', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    const result = runVerifyInit({ cwd });
    expect(result.gitignore.action).toBe('created');
    expect(readFileSync(path.join(cwd, '.gitignore'), 'utf8')).toBe('.records/\n');
  });

  it('.gitignore without .records/ entry → appends it, no dupes on re-run', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n');

    const result = runVerifyInit({ cwd });
    expect(result.gitignore.action).toBe('appended');
    const content = readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    expect(content).toBe('node_modules/\n.records/\n');

    const again = runVerifyInit({ cwd });
    expect(again.gitignore.action).toBe('no-op');
    expect(readFileSync(path.join(cwd, '.gitignore'), 'utf8')).toBe(content);
  });

  it('.gitignore already covers .records/ → no-op', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    writeFileSync(path.join(cwd, '.gitignore'), 'dist/\n.records/\n');

    const result = runVerifyInit({ cwd });
    expect(result.gitignore.action).toBe('no-op');
    expect(readFileSync(path.join(cwd, '.gitignore'), 'utf8')).toBe('dist/\n.records/\n');
  });

  it('never creates or touches .agents/verify/', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    const verifyAdapterDir = path.join(cwd, '.agents', 'verify');
    mkdirSync(verifyAdapterDir, { recursive: true });
    writeFileSync(path.join(verifyAdapterDir, 'PROJECT.md'), 'existing adapter content');

    runVerifyInit({ cwd });

    expect(readFileSync(path.join(verifyAdapterDir, 'PROJECT.md'), 'utf8')).toBe(
      'existing adapter content',
    );
    expect(existsSync(path.join(cwd, '.agents', 'skills', 'agent-testing'))).toBe(false);
  });
});

describe('isVerifyInitSuccess', () => {
  it('is true when at least one target installed/updated/no-op', () => {
    expect(isVerifyInitSuccess([{ message: '', status: 'installed', target: 'a' }])).toBe(true);
    expect(isVerifyInitSuccess([{ message: '', status: 'no-op', target: 'a' }])).toBe(true);
    expect(
      isVerifyInitSuccess([
        { message: '', status: 'refused', target: 'a' },
        { message: '', status: 'installed', target: 'b' },
      ]),
    ).toBe(true);
  });

  it('is false when every target refused, or there are no targets', () => {
    expect(isVerifyInitSuccess([{ message: '', status: 'refused', target: 'a' }])).toBe(false);
    expect(isVerifyInitSuccess([])).toBe(false);
  });
});

describe('HARNESS_SKILL_DIRS', () => {
  it('lists the three recognized harness dirs', () => {
    expect(HARNESS_SKILL_DIRS).toEqual(['.claude/skills', '.codex/skills', '.agents/skills']);
  });
});
