import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import semver from 'semver';

import { type BundledSkill, locateBundledSkill } from '../utils/skillLocator';

export const SKILL_NAME = 'agent-testing';
export const HARNESS_SKILL_DIRS = ['.claude/skills', '.codex/skills', '.agents/skills'];
const GITIGNORE_ENTRY = '.records/';
const EXECUTABLE_EXTENSIONS = new Set(['.sh', '.mjs', '.cjs']);

export interface SkillMeta {
  cliRoot: string;
  name: string;
  version: string;
}

export type InstallStatus = 'installed' | 'no-op' | 'refused' | 'updated';

export interface InstallResult {
  message: string;
  status: InstallStatus;
  target: string;
}

export interface VerifyInitOptions {
  cwd: string;
  force?: boolean;
  target?: string;
}

export interface VerifyInitResult {
  bundled: BundledSkill;
  gitignore: { action: 'appended' | 'created' | 'no-op'; path: string };
  isGitRepo: boolean;
  results: InstallResult[];
}

export class NoHarnessDirError extends Error {
  constructor(cwd: string) {
    super(
      `No harness skills directory found under ${cwd} ` +
        `(looked for ${HARNESS_SKILL_DIRS.join(', ')}). ` +
        'Pass --target <dir> to install into a specific directory.',
    );
    this.name = 'NoHarnessDirError';
  }
}

function findHarnessDirs(cwd: string): string[] {
  return HARNESS_SKILL_DIRS.map((d) => path.join(cwd, d)).filter((d) => existsSync(d));
}

function readSkillMeta(skillDir: string): SkillMeta | undefined {
  const metaPath = path.join(skillDir, '.skill-meta.json');
  if (!existsSync(metaPath)) return undefined;
  try {
    return JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    return undefined;
  }
}

function chmodExecutablesRecursive(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      chmodExecutablesRecursive(full);
    } else if (EXECUTABLE_EXTENSIONS.has(path.extname(entry.name))) {
      chmodSync(full, 0o755);
    }
  }
}

function writeSkillMeta(skillDir: string, meta: SkillMeta): void {
  writeFileSync(path.join(skillDir, '.skill-meta.json'), JSON.stringify(meta, null, 2) + '\n');
}

function installOne(
  harnessDir: string,
  bundled: BundledSkill,
  force: boolean | undefined,
): InstallResult {
  const target = path.join(harnessDir, SKILL_NAME);
  const exists = existsSync(target);
  const meta = exists ? readSkillMeta(target) : undefined;

  if (exists && !meta && !force) {
    return {
      message: `${path.join(target, '.skill-meta.json')} not found — this looks like a hand-written or pre-existing skill dir, refusing to overwrite. Pass --force to replace it.`,
      status: 'refused',
      target,
    };
  }

  if (meta && !force && semver.compare(bundled.version, meta.version) <= 0) {
    return {
      message: `already at version ${meta.version} (bundled: ${bundled.version})`,
      status: 'no-op',
      target,
    };
  }

  if (exists) rmSync(target, { recursive: true, force: true });
  cpSync(bundled.skillDir, target, { recursive: true });
  chmodExecutablesRecursive(target);
  writeSkillMeta(target, { cliRoot: bundled.cliRoot, name: SKILL_NAME, version: bundled.version });

  return {
    message: exists
      ? `updated ${meta?.version} → ${bundled.version}`
      : `installed ${bundled.version}`,
    status: exists ? 'updated' : 'installed',
    target,
  };
}

function ensureGitignore(cwd: string): { action: 'appended' | 'created' | 'no-op'; path: string } {
  const gitignorePath = path.join(cwd, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, `${GITIGNORE_ENTRY}\n`);
    return { action: 'created', path: gitignorePath };
  }

  const content = readFileSync(gitignorePath, 'utf8');
  const covered = content
    .split('\n')
    .map((line) => line.trim())
    .some((line) => line === GITIGNORE_ENTRY || line === GITIGNORE_ENTRY.replace(/\/$/, ''));
  if (covered) return { action: 'no-op', path: gitignorePath };

  const needsLeadingNewline = content.length > 0 && !content.endsWith('\n');
  writeFileSync(
    gitignorePath,
    content + (needsLeadingNewline ? '\n' : '') + `${GITIGNORE_ENTRY}\n`,
  );
  return { action: 'appended', path: gitignorePath };
}

export function runVerifyInit(options: VerifyInitOptions): VerifyInitResult {
  const bundled = locateBundledSkill(SKILL_NAME);
  const cwd = options.cwd;

  let targets: string[];
  if (options.target) {
    const resolved = path.resolve(cwd, options.target);
    mkdirSync(resolved, { recursive: true });
    targets = [resolved];
  } else {
    targets = findHarnessDirs(cwd);
    if (targets.length === 0) throw new NoHarnessDirError(cwd);
  }

  const results = targets.map((dir) => installOne(dir, bundled, options.force));
  const isGitRepo = existsSync(path.join(cwd, '.git'));
  const gitignore = ensureGitignore(cwd);

  return { bundled, gitignore, isGitRepo, results };
}

export function isVerifyInitSuccess(results: InstallResult[]): boolean {
  return results.some((r) => r.status !== 'refused');
}
