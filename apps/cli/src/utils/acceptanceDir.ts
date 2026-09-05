import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Every acceptance artifact a run produces lands under one project-local
 * directory, grouped the way the product itself groups them.
 *
 * ```
 * .acceptances/
 * ├── .gitignore                     # `*` — the whole tree stays out of git
 * └── <subject-key>/                 # topic-tpc_x | task-T-12 | document-doc_x | standalone-<id>
 *     ├── acceptance.json            # which acceptance these rounds belong to
 *     └── <YYYYMMDD-HHMMSS>-<slug>/  # ONE immutable round
 *         ├── result.json
 *         ├── report.md
 *         └── assets/
 * ```
 *
 * The subject key mirrors the `--subject <type>:<id>` vocabulary the CLI already
 * speaks, so a directory listing answers the same question the acceptance page
 * does: which delivery is this, and how many rounds has it had.
 */
export const ACCEPTANCE_DIR = '.acceptances';

export type IgnoreResult =
  { file: string; kind: 'added' } | { kind: 'present' } | { kind: 'skipped'; reason: string };

function isGitRepository(baseDir: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: baseDir, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Keep the artifact tree out of git, without touching the project's own
 * `.gitignore`.
 *
 * A round is a throwaway: a `result.json`, a narrative tail, and however many
 * screenshots and GIFs the evidence needed — megabytes of binaries that belong
 * on the acceptance page, not in a repository's history. Writing `*` into a
 * `.gitignore` INSIDE the directory ignores the whole tree including that file
 * (git still reads an ignore file that ignores itself), so the project's root
 * file is never rewritten and a `.acceptances/` line never shows up in someone
 * else's diff.
 *
 * This is deliberately the opposite call from the materialized skill, which is
 * a reviewable team asset and is meant to be committed. Artifacts are not.
 */
export function ensureAcceptanceDirIgnored(baseDir: string): IgnoreResult {
  if (!isGitRepository(baseDir)) return { kind: 'skipped', reason: 'not a git repository' };

  const dir = path.join(baseDir, ACCEPTANCE_DIR);
  const file = path.join(dir, '.gitignore');
  if (existsSync(file)) return { kind: 'present' };

  mkdirSync(dir, { recursive: true });
  writeFileSync(file, '*\n', 'utf8');
  return { file: path.join(ACCEPTANCE_DIR, '.gitignore'), kind: 'added' };
}

/** `topic:tpc_x` → `topic-tpc_x`; the directory name for one delivery's rounds. */
export function acceptanceSubjectKey(subject: string): string {
  const [type, ...rest] = subject.split(':');
  const id = rest.join(':').trim();
  return id ? `${type.trim()}-${id}` : type.trim();
}

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * `YYYYMMDD-HHMMSS-<slug>` — sortable, and the base name a round is written
 * under. Second resolution alone does NOT guarantee uniqueness (two workers can
 * start the same round in the same second), so allocation goes through
 * {@link acceptanceRoundDir}, which resolves collisions against the disk.
 */
export function acceptanceRoundDirName(slug: string, now: Date = new Date()): string {
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const normalized = slug
    .toLowerCase()
    .replaceAll(/[^\da-z]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  return normalized ? `${stamp}-${normalized}` : stamp;
}

/**
 * Allocate the directory one round is written to, under its subject's group.
 *
 * A round is immutable, so this never returns a path that already exists: two
 * rounds started inside the same second — parallel workers, or a fast
 * fix-and-reverify — would otherwise share a name and the second writer would
 * mix its evidence into the first one's published round.
 */
export function acceptanceRoundDir(
  baseDir: string,
  subject: string,
  slug: string,
  now?: Date,
): string {
  const group = path.join(baseDir, ACCEPTANCE_DIR, acceptanceSubjectKey(subject));
  const base = acceptanceRoundDirName(slug, now);

  let candidate = path.join(group, base);
  for (let suffix = 2; existsSync(candidate); suffix += 1) {
    candidate = path.join(group, `${base}-${suffix}`);
  }
  return candidate;
}

/**
 * Seed the ignore file for whichever `.acceptances/` tree a round directory
 * belongs to. A no-op when the round was written somewhere else — this must
 * never create the directory in a project that keeps its reports elsewhere.
 */
export function ensureAcceptanceDirIgnoredFor(roundDir: string): IgnoreResult {
  const segments = path.resolve(roundDir).split(path.sep);
  const index = segments.lastIndexOf(ACCEPTANCE_DIR);
  if (index <= 0) return { kind: 'skipped', reason: `not inside ${ACCEPTANCE_DIR}/` };

  return ensureAcceptanceDirIgnored(segments.slice(0, index).join(path.sep));
}
