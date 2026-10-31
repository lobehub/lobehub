import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** A repository's own acceptance adapter directory. */
export const ACCEPTANCE_ADAPTER_DIR = path.join('.agents', 'acceptance');
/** Machine-readable settings beside the adapter's `PROJECT.md`. */
export const ACCEPTANCE_CONFIG_FILE = 'config.json';

export type DeclaredProject =
  | { file: string; kind: 'declared'; project: string }
  | { file: string; kind: 'invalid'; reason: string };

const isDirectory = (dir: string) => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The repository a delivery came from: the NEAREST `.agents/acceptance/`
 * walking up from `startDir`. A nested checkout (a submodule) is its own
 * repository and never inherits its parent's settings.
 */
export function findAcceptanceAdapterDir(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  while (true) {
    const adapterDir = path.join(dir, ACCEPTANCE_ADAPTER_DIR);
    if (isDirectory(adapterDir)) return adapterDir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * The project a repository files its acceptances under, from
 * `.agents/acceptance/config.json` → `{ "project": "LOBE" }` (a project id,
 * slug or identifier). The first start directory inside a repository decides —
 * a report written to a scratch directory falls back to the working directory.
 * Returns undefined when nothing is declared.
 */
export function findDeclaredProject(startDirs: string[]): DeclaredProject | undefined {
  for (const startDir of startDirs) {
    const adapterDir = findAcceptanceAdapterDir(startDir);
    if (!adapterDir) continue;
    const file = path.join(adapterDir, ACCEPTANCE_CONFIG_FILE);
    return existsSync(file) ? readDeclaredProject(file) : undefined;
  }
}

const readDeclaredProject = (file: string): DeclaredProject | undefined => {
  let config: unknown;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { file, kind: 'invalid', reason: 'not valid JSON' };
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { file, kind: 'invalid', reason: 'expected a JSON object' };
  }

  const { project } = config as { project?: unknown };
  if (project === undefined) return undefined;
  if (typeof project !== 'string' || !project.trim()) {
    return { file, kind: 'invalid', reason: '"project" must be a non-empty string' };
  }
  return { file, kind: 'declared', project: project.trim() };
};
