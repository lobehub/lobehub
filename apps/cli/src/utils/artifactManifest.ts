import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

const MANIFEST_DIR = '.lobehub';
const MANIFEST_FILE = 'artifacts.json';

export interface ArtifactBinding {
  canvasId?: string;
  deploymentId?: string;
  pendingCanvas?: {
    canvasId?: string;
    createNew: boolean;
    deploymentId?: string;
    expectedVersion: number;
    fingerprint: string;
    previous: Omit<ArtifactBinding, 'pendingCanvas' | 'pendingCreateKey' | 'pendingType'>;
    rejectedPublication?: { requestedSlug?: string };
    saved?: { canvasId: string; version: number; workId: string };
  };
  /**
   * Set before a create is sent and cleared once its deployment is recorded, so
   * a retry after a lost response reuses the key and the server returns the
   * deployment it already made instead of minting a second site.
   */
  pendingCreateKey?: string;
  pendingType?: 'canvas' | 'html';
  scope?: string;
  type?: 'canvas' | 'html';
  version?: number;
  workId?: string;
}

interface ArtifactManifest {
  artifacts: Record<string, ArtifactBinding>;
  version: 1;
}

const bindingIdentity = {
  canvasId: z.string().min(1).optional(),
  deploymentId: z.string().min(1).optional(),
  scope: z.string().min(1).optional(),
  type: z.enum(['canvas', 'html']).optional(),
  version: z.number().int().positive().optional(),
  workId: z.string().min(1).optional(),
};

const bindingSchema = z
  .object({
    ...bindingIdentity,
    pendingCanvas: z
      .object({
        canvasId: z.string().min(1).optional(),
        createNew: z.boolean(),
        deploymentId: z.string().min(1).optional(),
        expectedVersion: z.number().int().nonnegative(),
        fingerprint: z.string().regex(/^[\da-f]{64}$/),
        previous: z.object(bindingIdentity).passthrough(),
        rejectedPublication: z.object({ requestedSlug: z.string().optional() }).optional(),
        saved: z
          .object({
            canvasId: z.string().min(1),
            version: z.number().int().positive(),
            workId: z.string().min(1),
          })
          .optional(),
      })
      .optional(),
    pendingCreateKey: z.string().min(1).optional(),
    pendingType: z.enum(['canvas', 'html']).optional(),
  })
  .passthrough()
  .superRefine((binding, ctx) => {
    if (
      (binding.pendingCanvas || binding.pendingType === 'canvas') &&
      (!binding.pendingCanvas ||
        !z.uuid().safeParse(binding.pendingCreateKey).success ||
        !binding.scope ||
        binding.pendingType !== 'canvas')
    ) {
      ctx.addIssue({ code: 'custom', message: 'Incomplete Canvas recovery state' });
    }
  });

const manifestSchema = z
  .object({
    artifacts: z.record(z.string(), bindingSchema),
    version: z.literal(1),
  })
  .passthrough();

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
  if (!fs.existsSync(manifestPath)) return emptyManifest();
  // Corrupt recovery data must not silently become a fresh publication.
  return manifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
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
