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

import type { Command } from 'commander';
import pc from 'picocolors';
import semver from 'semver';

import { outputJson } from '../utils/format';
import { log } from '../utils/logger';
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

export interface VerifyInstallOptions {
  cwd: string;
  force?: boolean;
  target?: string;
}

export interface VerifyInstallResult {
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
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (parsed?.name !== SKILL_NAME) return undefined;
    if (!semver.valid(parsed.version)) return undefined;
    return parsed;
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

// The consumer repo may vendor @lobehub/cli inside itself (e.g. this very
// monorepo), in which case cliRoot sits under cwd and an absolute path would
// bake this machine's filesystem layout into a committed marker file. Resolve
// relative to the marker's own directory instead, so the marker stays
// portable across machines and CI. Global installs / npx still resolve
// cliRoot outside the consumer repo, so those keep the absolute path — there
// is no repo-relative path to express.
function resolveCliRootForMeta(cliRoot: string, cwd: string, targetDir: string): string {
  const relFromCwd = path.relative(cwd, cliRoot);
  const isInsideRepo =
    relFromCwd !== '' && !relFromCwd.startsWith('..') && !path.isAbsolute(relFromCwd);
  if (!isInsideRepo) return cliRoot;

  const relFromTarget = path.relative(targetDir, cliRoot);
  return relFromTarget.split(path.sep).join('/');
}

function installOne(
  harnessDir: string,
  bundled: BundledSkill,
  force: boolean | undefined,
  cwd: string,
): InstallResult {
  const target = path.join(harnessDir, SKILL_NAME);
  const exists = existsSync(target);
  const meta = exists ? readSkillMeta(target) : undefined;

  if (exists && !meta && !force) {
    return {
      message: `${path.join(target, '.skill-meta.json')} is missing or is not a ${SKILL_NAME} marker — this looks like a hand-written or pre-existing skill dir, refusing to overwrite. Pass --force to replace it.`,
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
  writeSkillMeta(target, {
    cliRoot: resolveCliRootForMeta(bundled.cliRoot, cwd, target),
    name: SKILL_NAME,
    version: bundled.version,
  });

  return {
    message: exists
      ? meta
        ? `updated ${meta.version} → ${bundled.version}`
        : `replaced unversioned install with ${bundled.version}`
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

export function runVerifyInstall(options: VerifyInstallOptions): VerifyInstallResult {
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

  const results = targets.map((dir) => installOne(dir, bundled, options.force, cwd));
  const isGitRepo = existsSync(path.join(cwd, '.git'));
  const gitignore = ensureGitignore(cwd);

  return { bundled, gitignore, isGitRepo, results };
}

export function isVerifyInstallSuccess(results: InstallResult[]): boolean {
  return results.some((r) => r.status !== 'refused');
}

// ── Command Registration ───────────────────────────────────

const STATUS_GLYPH: Record<InstallStatus, string> = {
  'installed': pc.green('✓ installed'),
  'no-op': pc.dim('· no-op'),
  'refused': pc.red('✗ refused'),
  'updated': pc.yellow('↑ updated'),
};

export function registerVerifyInstallCommand(verify: Command) {
  verify
    .command('install')
    .description(
      "Install the bundled agent-testing skill into this repo's agent skill dirs (.claude/.codex/.agents)",
    )
    .option('--target <dir>', 'Install into a specific directory instead of auto-detecting')
    .option('--force', 'Replace an existing install even without a recognized version marker')
    .option('--json [fields]', 'Output JSON')
    .action(async (options: { force?: boolean; json?: boolean | string; target?: string }) => {
      let result: VerifyInstallResult;
      try {
        result = runVerifyInstall({
          cwd: process.cwd(),
          force: options.force,
          target: options.target,
        });
      } catch (e) {
        if (e instanceof NoHarnessDirError) {
          log.error(e.message);
          process.exit(1);
          return;
        }
        throw e;
      }

      const success = isVerifyInstallSuccess(result.results);

      if (options.json !== undefined) {
        outputJson(result, typeof options.json === 'string' ? options.json : undefined);
        process.exit(success ? 0 : 1);
        return;
      }

      for (const r of result.results) {
        console.log(
          `${STATUS_GLYPH[r.status]} ${pc.dim(path.relative(process.cwd(), r.target) || r.target)} ${pc.dim(`— ${r.message}`)}`,
        );
      }

      if (!result.isGitRepo) {
        console.log(
          pc.yellow('  (not a git repository — .records/ hygiene must be handled manually)'),
        );
      }
      if (result.gitignore.action !== 'no-op') {
        console.log(
          pc.dim(
            `  .gitignore ${result.gitignore.action === 'created' ? 'created with' : 'updated with'} ${GITIGNORE_ENTRY}`,
          ),
        );
      }

      console.log(
        pc.dim(
          '  First verification run bootstraps .agents/verify/PROJECT.md — see the skill docs.',
        ),
      );

      if (!success) process.exit(1);
    });
}
