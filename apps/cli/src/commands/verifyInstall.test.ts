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

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HARNESS_SKILL_DIRS,
  isVerifyInstallSuccess,
  NoHarnessDirError,
  registerVerifyInstallCommand,
  runVerifyInstall,
} from './verifyInstall';

const { mockLocateBundledSkill } = vi.hoisted(() => ({
  mockLocateBundledSkill: vi.fn(),
}));
vi.mock('../utils/skillLocator', () => ({ locateBundledSkill: mockLocateBundledSkill }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

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
  root = mkdtempSync(path.join(tmpdir(), 'verify-install-'));
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
  return mkdtempSync(path.join(root, 'consumer-'));
}

describe('runVerifyInstall — no harness dir found', () => {
  it('throws NoHarnessDirError listing recognized dirs, without --target', () => {
    const cwd = makeCwd();
    expect(() => runVerifyInstall({ cwd })).toThrow(NoHarnessDirError);
    try {
      runVerifyInstall({ cwd });
    } catch (e) {
      expect((e as Error).message).toContain('.claude/skills');
      expect((e as Error).message).toContain('.codex/skills');
      expect((e as Error).message).toContain('.agents/skills');
      expect((e as Error).message).toContain('--target');
    }
  });
});

describe('runVerifyInstall — fresh install', () => {
  it('installs into a single existing harness dir', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });

    const result = runVerifyInstall({ cwd });

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

  it('cliRoot outside the consumer repo → marker keeps the absolute path', () => {
    // bundleDir/cliRoot live under `root`, sibling to (not inside) `cwd` —
    // simulates a global install / npx where @lobehub/cli sits outside the
    // consumer repo entirely.
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });

    const result = runVerifyInstall({ cwd });

    const target = result.results[0].target;
    const meta = JSON.parse(readFileSync(path.join(target, '.skill-meta.json'), 'utf8'));
    expect(meta.cliRoot).toBe(path.join(root, '__bundle__'));
    expect(path.isAbsolute(meta.cliRoot)).toBe(true);
  });

  it('cliRoot inside the consumer repo → marker stores a POSIX-relative path from the marker dir', () => {
    // Simulates @lobehub/cli vendored inside the consumer repo itself (e.g.
    // this monorepo): cliRoot sits under cwd, so baking in an absolute path
    // would commit a machine-specific filesystem layout.
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    const inRepoCliRoot = path.join(cwd, 'apps', 'cli');
    mkdirSync(inRepoCliRoot, { recursive: true });
    mockLocateBundledSkill.mockReturnValue({
      cliRoot: inRepoCliRoot,
      skillDir: bundleDir,
      version: '1.0.0',
    });

    const result = runVerifyInstall({ cwd });

    const target = result.results[0].target;
    const meta = JSON.parse(readFileSync(path.join(target, '.skill-meta.json'), 'utf8'));
    expect(meta.cliRoot).toBe('../../../apps/cli');
    expect(path.isAbsolute(meta.cliRoot)).toBe(false);
    expect(path.resolve(target, meta.cliRoot)).toBe(inRepoCliRoot);
  });

  it('installs into every existing harness dir (multi-harness)', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    mkdirSync(path.join(cwd, '.codex', 'skills'), { recursive: true });
    // .agents/skills intentionally absent

    const result = runVerifyInstall({ cwd });

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
    const result = runVerifyInstall({ cwd });
    const target = result.results[0].target;

    const shMode = statSync(path.join(target, 'scripts', 'run.sh')).mode & 0o777;
    const mjsMode = statSync(path.join(target, 'scripts', 'analyze.mjs')).mode & 0o777;
    expect(shMode & 0o111).toBe(0o111);
    expect(mjsMode & 0o111).toBe(0o111);
  });

  it('respects --target, creating the dir if missing, and does not touch harness dirs', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true }); // present but must be ignored

    const result = runVerifyInstall({ cwd, target: 'custom/skills-dir' });

    expect(result.results).toHaveLength(1);
    const target = path.join(cwd, 'custom', 'skills-dir', 'agent-testing');
    expect(result.results[0].target).toBe(target);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(path.join(cwd, '.claude', 'skills', 'agent-testing'))).toBe(false);
  });
});

describe('runVerifyInstall — edge cases', () => {
  it('version marker present, bundled version newer → overwrites skill body', () => {
    const cwd = makeCwd();
    const skillsDir = path.join(cwd, '.claude', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    runVerifyInstall({ cwd }); // installs 1.0.0

    mockLocateBundledSkill.mockReturnValue({
      cliRoot: path.join(root, '__bundle__'),
      skillDir: bundleDir,
      version: '2.0.0',
    });
    writeFileSync(path.join(bundleDir, 'SKILL.md'), '# agent-testing v2');

    const result = runVerifyInstall({ cwd });
    expect(result.results[0].status).toBe('updated');
    const target = path.join(skillsDir, 'agent-testing');
    expect(readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# agent-testing v2');
    const meta = JSON.parse(readFileSync(path.join(target, '.skill-meta.json'), 'utf8'));
    expect(meta.version).toBe('2.0.0');
  });

  it('marker present, same version → no-op with message', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    runVerifyInstall({ cwd });

    const result = runVerifyInstall({ cwd });
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
    runVerifyInstall({ cwd }); // installs 5.0.0

    mockLocateBundledSkill.mockReturnValue({
      cliRoot: path.join(root, '__bundle__'),
      skillDir: bundleDir,
      version: '1.0.0',
    });
    const result = runVerifyInstall({ cwd });
    expect(result.results[0].status).toBe('no-op');
  });

  it('target agent-testing dir exists WITHOUT marker → refuses; --force replaces', () => {
    const cwd = makeCwd();
    const skillsDir = path.join(cwd, '.claude', 'skills');
    const target = path.join(skillsDir, 'agent-testing');
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'SKILL.md'), '# hand-written predecessor');

    const refused = runVerifyInstall({ cwd });
    expect(refused.results[0].status).toBe('refused');
    expect(readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# hand-written predecessor');

    const forced = runVerifyInstall({ cwd, force: true });
    expect(forced.results[0].status).toBe('updated');
    expect(readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# agent-testing');
    expect(forced.results[0].message).toBe('replaced unversioned install with 1.0.0');
  });

  it('marker present but with invalid/missing version → refuses; --force replaces', () => {
    const cwd = makeCwd();
    const skillsDir = path.join(cwd, '.claude', 'skills');
    const target = path.join(skillsDir, 'agent-testing');
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'SKILL.md'), '# hand-written predecessor');
    writeFileSync(path.join(target, '.skill-meta.json'), '{}');

    const refused = runVerifyInstall({ cwd });
    expect(refused.results[0].status).toBe('refused');

    const forced = runVerifyInstall({ cwd, force: true });
    expect(forced.results[0].status).toBe('updated');
    expect(readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# agent-testing');
  });

  it('marker from another tool → refuses instead of trusting its version; --force replaces', () => {
    const cwd = makeCwd();
    const target = path.join(cwd, '.claude', 'skills', 'agent-testing');
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'SKILL.md'), '# someone else’s skill');
    writeFileSync(
      path.join(target, '.skill-meta.json'),
      JSON.stringify({ name: 'other', version: '999.0.0' }),
    );

    const refused = runVerifyInstall({ cwd });
    expect(refused.results[0].status).toBe('refused');
    expect(readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# someone else’s skill');

    const forced = runVerifyInstall({ cwd, force: true });
    expect(forced.results[0].status).toBe('updated');
    expect(readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('# agent-testing');
  });

  it('consumer cwd not a git repo → installs anyway, reports isGitRepo: false', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    const result = runVerifyInstall({ cwd });
    expect(result.isGitRepo).toBe(false);
    expect(result.results[0].status).toBe('installed');
  });

  it('cwd is a git repo → reports isGitRepo: true', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    mkdirSync(path.join(cwd, '.git'), { recursive: true });
    const result = runVerifyInstall({ cwd });
    expect(result.isGitRepo).toBe(true);
  });

  it('no .gitignore at cwd → creates one containing .records/', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    const result = runVerifyInstall({ cwd });
    expect(result.gitignore.action).toBe('created');
    expect(readFileSync(path.join(cwd, '.gitignore'), 'utf8')).toBe('.records/\n');
  });

  it('.gitignore without .records/ entry → appends it, no dupes on re-run', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n');

    const result = runVerifyInstall({ cwd });
    expect(result.gitignore.action).toBe('appended');
    const content = readFileSync(path.join(cwd, '.gitignore'), 'utf8');
    expect(content).toBe('node_modules/\n.records/\n');

    const again = runVerifyInstall({ cwd });
    expect(again.gitignore.action).toBe('no-op');
    expect(readFileSync(path.join(cwd, '.gitignore'), 'utf8')).toBe(content);
  });

  it('.gitignore already covers .records/ → no-op', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    writeFileSync(path.join(cwd, '.gitignore'), 'dist/\n.records/\n');

    const result = runVerifyInstall({ cwd });
    expect(result.gitignore.action).toBe('no-op');
    expect(readFileSync(path.join(cwd, '.gitignore'), 'utf8')).toBe('dist/\n.records/\n');
  });

  it('never creates or touches .agents/verify/', () => {
    const cwd = makeCwd();
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    const verifyAdapterDir = path.join(cwd, '.agents', 'verify');
    mkdirSync(verifyAdapterDir, { recursive: true });
    writeFileSync(path.join(verifyAdapterDir, 'PROJECT.md'), 'existing adapter content');

    runVerifyInstall({ cwd });

    expect(readFileSync(path.join(verifyAdapterDir, 'PROJECT.md'), 'utf8')).toBe(
      'existing adapter content',
    );
    expect(existsSync(path.join(cwd, '.agents', 'skills', 'agent-testing'))).toBe(false);
  });
});

describe('isVerifyInstallSuccess', () => {
  it('is true when at least one target installed/updated/no-op', () => {
    expect(isVerifyInstallSuccess([{ message: '', status: 'installed', target: 'a' }])).toBe(true);
    expect(isVerifyInstallSuccess([{ message: '', status: 'no-op', target: 'a' }])).toBe(true);
    expect(
      isVerifyInstallSuccess([
        { message: '', status: 'refused', target: 'a' },
        { message: '', status: 'installed', target: 'b' },
      ]),
    ).toBe(true);
  });

  it('is false when every target refused, or there are no targets', () => {
    expect(isVerifyInstallSuccess([{ message: '', status: 'refused', target: 'a' }])).toBe(false);
    expect(isVerifyInstallSuccess([])).toBe(false);
  });
});

describe('HARNESS_SKILL_DIRS', () => {
  it('lists the three recognized harness dirs', () => {
    expect(HARNESS_SKILL_DIRS).toEqual(['.claude/skills', '.codex/skills', '.agents/skills']);
  });
});

describe('lh verify install — command registration', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let cwd: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    cwd = makeCwd();
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
    cwdSpy.mockRestore();
  });

  const run = async (args: string[]) => {
    const program = new Command();
    program.exitOverride();
    const verify = program.command('verify');
    registerVerifyInstallCommand(verify);
    await program.parseAsync(['node', 'lh', 'verify', ...args]);
  };

  it('is registered as `verify install`, distinct from `verify init`', async () => {
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    await run(['install']);

    expect(existsSync(path.join(cwd, '.claude', 'skills', 'agent-testing', 'SKILL.md'))).toBe(true);
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it('happy path installs and prints a per-target result line', async () => {
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    await run(['install']);

    const printed = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('installed');
    expect(printed).toContain('agent-testing');
    expect(printed).toContain('PROJECT.md');
  });

  it('--json outputs the structured result and exits 0 on success', async () => {
    mkdirSync(path.join(cwd, '.claude', 'skills'), { recursive: true });
    await run(['install', '--json']);

    const out = JSON.parse(consoleSpy.mock.calls.map((c) => String(c[0])).join(''));
    expect(out.results[0].status).toBe('installed');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('--target installs into the given dir even without a recognized harness dir', async () => {
    await run(['install', '--target', 'custom-dir']);
    expect(existsSync(path.join(cwd, 'custom-dir', 'agent-testing', 'SKILL.md'))).toBe(true);
  });

  it('exits non-zero and logs an error when no harness dir and no --target', async () => {
    await run(['install']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
