import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * pnpm 12 writes `node_modules` links with too many `../` segments for
 * workspace members that live outside the install root. The desktop app
 * installs `apps/cli` as such a member (`../cli` in its workspace) and then
 * builds the CLI bundle from it, so `apps/cli/node_modules/@lobechat/*` ends up
 * dangling. Rolldown cannot resolve those imports, keeps them external, and the
 * embedded CLI dies at startup with ERR_MODULE_NOT_FOUND.
 *
 * Repointing the dangling links keeps the bundle buildable from any install
 * root until pnpm resolves the paths correctly again.
 */
const readPackageName = (dir: string): string | undefined => {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return typeof manifest.name === 'string' ? manifest.name : undefined;
  } catch {
    return undefined;
  }
};

/** Maps every package name under `packages/` to its directory, `business/*` included. */
const collectWorkspacePackages = (packagesDir: string): Map<string, string> => {
  const packages = new Map<string, string>();

  const visit = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue;

      const packageDir = path.join(dir, entry.name);
      const name = readPackageName(packageDir);

      if (name) {
        packages.set(name, packageDir);
      } else if (depth > 0) {
        visit(packageDir, depth - 1);
      }
    }
  };

  visit(packagesDir, 1);

  return packages;
};

const workspaceDependencies = (packageJsonPath: string): string[] => {
  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const declared: Record<string, string> = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };

  return Object.entries(declared)
    .filter(([, version]) => version.startsWith('workspace:'))
    .map(([name]) => name);
};

const linkPackage = (linkPath: string, targetDir: string) => {
  fs.rmSync(linkPath, { force: true, recursive: true });
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  // Junctions need an absolute target; they are the only link type Windows
  // grants without developer mode.
  if (process.platform === 'win32') {
    fs.symlinkSync(targetDir, linkPath, 'junction');
    return;
  }

  fs.symlinkSync(path.relative(path.dirname(linkPath), targetDir), linkPath, 'dir');
};

export interface EnsureWorkspaceLinksResult {
  /** Declared workspace dependencies with no matching package directory. */
  missing: string[];
  /** Packages whose link was dangling or absent and has been recreated. */
  repaired: string[];
}

export const ensureWorkspaceLinks = (packageDir: string): EnsureWorkspaceLinksResult => {
  const repoRoot = path.resolve(packageDir, '../..');
  const packages = collectWorkspacePackages(path.join(repoRoot, 'packages'));

  const missing: string[] = [];
  const repaired: string[] = [];

  for (const name of workspaceDependencies(path.join(packageDir, 'package.json'))) {
    const targetDir = packages.get(name);

    if (!targetDir) {
      missing.push(name);
      continue;
    }

    const linkPath = path.join(packageDir, 'node_modules', name);

    // `existsSync` follows symlinks, so a dangling link reads as missing.
    if (fs.existsSync(linkPath)) continue;

    linkPackage(linkPath, targetDir);
    repaired.push(name);
  }

  return { missing, repaired };
};

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const { missing, repaired } = ensureWorkspaceLinks(
    path.resolve(fileURLToPath(import.meta.url), '../..'),
  );

  if (repaired.length > 0) {
    console.info(`✅ Repaired ${repaired.length} workspace link(s): ${repaired.join(', ')}`);
  }

  if (missing.length > 0) {
    console.error(`❌ No workspace package found for: ${missing.join(', ')}`);
    process.exit(1);
  }
}
