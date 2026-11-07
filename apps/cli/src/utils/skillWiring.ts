import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs';
import path from 'node:path';

export const AGENTS_SKILLS_DIR = path.join('.agents', 'skills');

export type LinkResult =
  | { kind: 'already'; link: string }
  | { kind: 'linked'; link: string; target: string }
  | { kind: 'linked-single'; link: string; target: string }
  | { kind: 'none' }
  | { kind: 'skipped'; link: string; reason: string };

type Harness = {
  /** Dot directory that receives the `skills` symlink. */
  dir: string;
  name: string;
  /** Marker files/dirs that prove this harness is used in the repo. */
  signals: string[];
  /** Subdirectory the harness scans for skills ('skill' for OpenCode). */
  skillsSubdir: string;
};

/**
 * Harness dirs wired onto `.agents/skills`. Two reasons a dir is listed:
 *
 *  - the harness does not scan `.agents/skills` natively (Claude Code's
 *    `.claude/skills`, OpenCode's `.opencode/skill`, Windsurf's
 *    `.windsurf/skills`, Roo Code's `.roo/skills`), or
 *  - another harness compatibility-reads it (Cursor reads `.codex/skills` and
 *    `.claude/skills`, so a repo already carrying `.codex` config gets wired).
 *
 * Codex, Cursor, Gemini CLI, Copilot/VS Code and Amp all read `.agents/skills`
 * directly (Cursor additionally reads its own `.cursor/skills`, wired above).
 * `.github` is deliberately absent: it exists in almost every repo (workflows)
 * and Copilot already reads `.agents/skills`, so wiring it would be pure noise.
 */
const HARNESSES: Harness[] = [
  { dir: '.claude', name: 'claude', signals: ['CLAUDE.md', '.claude'], skillsSubdir: 'skills' },
  { dir: '.codex', name: 'codex', signals: ['.codex'], skillsSubdir: 'skills' },
  { dir: '.cursor', name: 'cursor', signals: ['.cursor'], skillsSubdir: 'skills' },
  { dir: '.gemini', name: 'gemini', signals: ['.gemini', 'GEMINI.md'], skillsSubdir: 'skills' },
  {
    dir: '.opencode',
    name: 'opencode',
    signals: ['.opencode', 'opencode.json', 'opencode.jsonc'],
    skillsSubdir: 'skill',
  },
  { dir: '.roo', name: 'roo', signals: ['.roo'], skillsSubdir: 'skills' },
  { dir: '.windsurf', name: 'windsurf', signals: ['.windsurf'], skillsSubdir: 'skills' },
];

export function detectHarness(baseDir: string, harness: Harness): boolean {
  return harness.signals.some((signal) => existsSync(path.join(baseDir, signal)));
}

export function detectClaudeHarness(baseDir: string): boolean {
  return detectHarness(baseDir, HARNESSES[0]);
}

function isSymlink(target: string): boolean {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

function linkOneHarness(baseDir: string, skillId: string, harness: Harness): LinkResult {
  const harnessDir = path.join(baseDir, harness.dir);
  const link = path.join(harnessDir, harness.skillsSubdir);
  const rel = path.join(harness.dir, harness.skillsSubdir);

  if (isSymlink(link)) {
    const current = readlinkSync(link);
    const resolved = path.resolve(harnessDir, current);
    if (resolved === path.join(baseDir, AGENTS_SKILLS_DIR)) return { kind: 'already', link: rel };
    return {
      kind: 'skipped',
      link: rel,
      reason: `already a symlink to ${current} — leaving it alone`,
    };
  }

  mkdirSync(harnessDir, { recursive: true });

  // A real directory means the user keeps harness-only skills there; never
  // clobber it — link just this one skill inside instead.
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

/**
 * `.agents/skills` is the single materialized copy; every detected harness dir
 * is a symlink onto it, so one install/update reaches all of them.
 */
export function linkHarnessSkills(baseDir: string, skillId: string): LinkResult[] {
  const detected = HARNESSES.filter((harness) => detectHarness(baseDir, harness));
  if (detected.length === 0) return [{ kind: 'none' }];
  return detected.map((harness) => linkOneHarness(baseDir, skillId, harness));
}
