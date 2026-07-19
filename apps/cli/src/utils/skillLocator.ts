import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BundledSkill {
  cliRoot: string;
  skillDir: string;
  version: string;
}

// Anchored to a package.json name match rather than a fixed relative depth
// because the caller's own file lives at a different depth in the built
// dist/index.js layout (global install / npx) vs. the monorepo dev entry
// (bun src/index.ts).
export function findCliRoot(startDir: string): string | undefined {
  let dir = startDir;
  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg && pkg.name === '@lobehub/cli') return dir;
      } catch {
        // Not a readable/valid package.json — keep walking up.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

// startDir is anchored to this module's own location by the caller
// (import.meta.url), never process.cwd() — resolution must not depend on
// where the CLI happens to be invoked from.
export function locateBundledSkill(
  skillName = 'agent-testing',
  startDir: string = path.dirname(fileURLToPath(import.meta.url)),
): BundledSkill {
  const cliRoot = findCliRoot(startDir);
  if (!cliRoot) {
    throw new Error(
      `Could not locate the @lobehub/cli package root walking up from ${startDir}. ` +
        'The CLI install may be corrupted.',
    );
  }

  const skillDir = path.join(cliRoot, 'skills', skillName);
  if (!existsSync(skillDir)) {
    throw new Error(
      `Bundled skill "${skillName}" not found at ${skillDir}. ` +
        'The @lobehub/cli install may be missing its skills/ directory.',
    );
  }

  const pkg = JSON.parse(readFileSync(path.join(cliRoot, 'package.json'), 'utf8'));

  return { cliRoot, skillDir, version: pkg.version };
}
