import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const AGENTS_SKILLS_DIR = path.join('.agents', 'skills');

export type LinkResult =
  | { kind: 'already'; link: string }
  | { kind: 'linked'; link: string; target: string }
  | { kind: 'linked-single'; link: string; target: string }
  | { kind: 'none' }
  | { kind: 'skipped'; link: string; reason: string };

export type IgnoreResult =
  | { kind: 'added'; entry: string; file: string }
  | { kind: 'present'; entry: string; file: string }
  | { kind: 'skipped'; reason: string };

export function detectClaudeHarness(baseDir: string): boolean {
  return existsSync(path.join(baseDir, 'CLAUDE.md')) || existsSync(path.join(baseDir, '.claude'));
}

function isSymlink(target: string): boolean {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * `.agents/skills` is the single materialized copy; every other harness dir is a
 * symlink onto it, so one install/update reaches all of them.
 */
export function linkHarnessSkills(baseDir: string, skillId: string): LinkResult {
  if (!detectClaudeHarness(baseDir)) return { kind: 'none' };

  const claudeDir = path.join(baseDir, '.claude');
  const link = path.join(claudeDir, 'skills');
  const rel = path.join('.claude', 'skills');

  if (isSymlink(link)) {
    const current = readlinkSync(link);
    const resolved = path.resolve(claudeDir, current);
    if (resolved === path.join(baseDir, AGENTS_SKILLS_DIR)) return { kind: 'already', link: rel };
    return {
      kind: 'skipped',
      link: rel,
      reason: `already a symlink to ${current} — leaving it alone`,
    };
  }

  mkdirSync(claudeDir, { recursive: true });

  // A real directory means the user keeps Claude-only skills there; never clobber
  // it — link just this one skill inside instead.
  if (existsSync(link)) {
    const single = path.join(link, skillId);
    if (isSymlink(single) || existsSync(single))
      return { kind: 'already', link: path.join(rel, skillId) };
    const target = path.join('..', '..', AGENTS_SKILLS_DIR, skillId);
    try {
      symlinkSync(target, single, 'dir');
    } catch (error) {
      return { kind: 'skipped', link: path.join(rel, skillId), reason: (error as Error).message };
    }
    return { kind: 'linked-single', link: path.join(rel, skillId), target };
  }

  const target = path.join('..', AGENTS_SKILLS_DIR);
  try {
    symlinkSync(target, link, 'dir');
  } catch (error) {
    return { kind: 'skipped', link: rel, reason: (error as Error).message };
  }
  return { kind: 'linked', link: rel, target };
}

function findGitRoot(startDir: string): string | undefined {
  let dir = startDir;
  while (true) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function isIgnoredByGit(baseDir: string, relPath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', relPath], { cwd: baseDir, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function appendIgnoreEntry(file: string, entry: string): IgnoreResult {
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (existing.split('\n').some((line) => line.trim() === entry)) {
    return { entry, file, kind: 'present' };
  }
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(file, `${existing}${prefix}${entry}\n`, 'utf8');
  return { entry, file, kind: 'added' };
}

/**
 * Nested `.agents/skills/.gitignore` owns the list of materialized skills, so the
 * project's root file stays untouched — it only gains a line when we created the
 * `.claude/skills` symlink and git isn't ignoring it already.
 */
export function ensureSkillIgnored(
  baseDir: string,
  skillId: string,
  createdRootLink: boolean,
): IgnoreResult[] {
  if (!findGitRoot(baseDir)) return [{ kind: 'skipped', reason: 'not a git repository' }];

  const results: IgnoreResult[] = [];
  const skillsDir = path.join(baseDir, AGENTS_SKILLS_DIR);
  mkdirSync(skillsDir, { recursive: true });

  // A file we generate must not itself become untracked noise. Git still reads an
  // ignore file that ignores itself, so seeding this line keeps `git status`
  // clean. Only when we create it — an existing file is the project's own.
  const nested = path.join(skillsDir, '.gitignore');
  if (!existsSync(nested)) appendIgnoreEntry(nested, '/.gitignore');

  results.push(appendIgnoreEntry(nested, `/${skillId}/`));

  if (createdRootLink) {
    const rel = '.claude/skills';
    if (!isIgnoredByGit(baseDir, rel)) {
      results.push(appendIgnoreEntry(path.join(baseDir, '.gitignore'), `/${rel}`));
    }
  }

  return results;
}
