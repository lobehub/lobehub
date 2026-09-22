import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MANIFEST_DIR = '.lobehub';
const MANIFEST_FILE = 'artifacts.json';

export interface ArtifactBinding {
  deploymentId?: string;
  /**
   * Set before a create is sent and cleared once its deployment is recorded, so
   * a retry after a lost response reuses the key and the server returns the
   * deployment it already made instead of minting a second site.
   */
  pendingCreateKey?: string;
}

interface ArtifactManifest {
  artifacts: Record<string, ArtifactBinding>;
  version: 1;
}

export interface ResolvedManifest {
  entryKey: string;
  path: string;
  root: string;
}

const emptyManifest = (): ArtifactManifest => ({ artifacts: {}, version: 1 });

const findUp = (from: string, relative: string): string | undefined => {
  let dir = from;

  for (;;) {
    if (fs.existsSync(path.join(dir, relative))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
};

/**
 * The manifest is committed with the project so a publish from CI targets the
 * same deployment a developer created locally. Its directory is therefore the
 * project root: an existing manifest wins, then the enclosing repository, and
 * failing both the directory the publish was already scoped to. Never the
 * process cwd — that can be unrelated to the file being published, and would
 * drop a manifest into whichever directory the command happened to run from.
 */
export const resolveManifest = (entryPath: string, fallbackRoot: string): ResolvedManifest => {
  const from = path.dirname(path.resolve(entryPath));
  const root =
    findUp(from, path.join(MANIFEST_DIR, MANIFEST_FILE)) ??
    findUp(from, '.git') ??
    path.resolve(fallbackRoot);

  return {
    entryKey: path.relative(root, path.resolve(entryPath)).split(path.sep).join('/'),
    path: path.join(root, MANIFEST_DIR, MANIFEST_FILE),
    root,
  };
};

const readManifest = (manifestPath: string): ArtifactManifest => {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return emptyManifest();

    const artifacts = (parsed as ArtifactManifest).artifacts;
    if (!artifacts || typeof artifacts !== 'object') return emptyManifest();

    return { artifacts, version: 1 };
  } catch {
    // absent or unreadable — the caller creates a fresh deployment
    return emptyManifest();
  }
};

export const readBinding = (manifest: ResolvedManifest): ArtifactBinding =>
  readManifest(manifest.path)['artifacts'][manifest.entryKey] ?? {};

export const writeBinding = (manifest: ResolvedManifest, binding: ArtifactBinding): void => {
  const current = readManifest(manifest.path);
  const next: ArtifactManifest = {
    ...current,
    artifacts: { ...current.artifacts, [manifest.entryKey]: binding },
  };

  fs.mkdirSync(path.dirname(manifest.path), { recursive: true });
  // Write-then-rename: a crash must not leave a truncated manifest, which would
  // read as "no binding" and publish a duplicate site on the next run.
  const temporary = `${manifest.path}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(temporary, manifest.path);
};

export const createIdempotencyKey = (): string => randomUUID();
