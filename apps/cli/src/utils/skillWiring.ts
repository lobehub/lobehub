import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs';
import path from 'node:path';

export const AGENTS_SKILLS_DIR = path.join('.agents', 'skills');

export type LinkResult =
  | { kind: 'already'; link: string }
  | { kind: 'linked'; link: string; target: string }
  | { kind: 'linked-single'; link: string; target: string }
  | { kind: 'none' }
  | { kind: 'skipped'; link: string; reason: string };

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
