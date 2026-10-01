import { createHash, verify as cryptoVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import * as z from 'zod/v4';

import type { ShellGlobal } from '@/const/shell';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const packPathSchema = z.string().regex(/^packs\/[0-9a-f]{64}\.zip$/);
const relativePathSchema = z.string().refine((value) => {
  if (!value || value.startsWith('/') || value.startsWith('\\') || value.includes('\\')) {
    return false;
  }
  return value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
});

export const rendererTreeFileSchema = z
  .object({
    path: relativePathSchema,
    sha256: sha256Schema,
    size: z.number().int().nonnegative(),
  })
  .strict();

export const rendererArtifactSchema = z
  .object({
    path: packPathSchema,
    sha256: sha256Schema,
    size: z.number().int().positive(),
  })
  .strict()
  .refine((artifact) => artifact.path === `packs/${artifact.sha256}.zip`);

export const rendererTreeSchema = z
  .array(rendererTreeFileSchema)
  .min(1)
  .superRefine((tree, ctx) => {
    const paths = new Set<string>();
    for (const file of tree) {
      if (paths.has(file.path)) {
        ctx.addIssue({ code: 'custom', message: `duplicate renderer path: ${file.path}` });
      }
      paths.add(file.path);
    }
  });

export const corePatchSchema = z
  .object({
    fromSha256: sha256Schema,
    size: z.number().int().positive(),
    toSha256: sha256Schema,
  })
  .strict();

export const coreManifestV3Schema = z
  .object({
    applyMode: z.enum(['reload', 'relaunch']).nullable(),
    channel: z.enum(['stable', 'beta', 'canary', 'nightly']),
    full: rendererArtifactSchema,
    objectsBaseUrl: z.url(),
    patches: z.array(corePatchSchema),
    platform: z.enum(['darwin', 'win32', 'linux']),
    previous: z.string().nullable(),
    rollout: z.number().min(0).max(1).default(1),
    schemaVersion: z.literal(3),
    seq: z.number().int().nonnegative(),
    shellAbi: sha256Schema,
    signature: z.string().min(1),
    tree: rendererTreeSchema,
    version: z.string().min(1),
  })
  .strict();

// The builtin manifest ships inside the code-signed app bundle, so it is built without the OTA key.
export const builtinManifestSchema = coreManifestV3Schema.extend({ signature: z.string() });

const packSchema = z
  .object({
    path: z.string().regex(/^packs\/[0-9a-f]{64}\.pack$/),
    sha256: sha256Schema,
    size: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 ** 3),
  })
  .strict()
  .refine((pack) => pack.path === `packs/${pack.sha256}.pack`);

const frameSchema = z
  .object({
    compressedSha256: sha256Schema,
    length: z
      .number()
      .int()
      .positive()
      .max(256 * 1024 ** 2),
    offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    packSha256: sha256Schema,
  })
  .strict();

export const coreManifestV4Schema = coreManifestV3Schema
  .omit({
    full: true,
    objectsBaseUrl: true,
    patches: true,
    schemaVersion: true,
  })
  .extend({
    objects: z.record(sha256Schema, frameSchema),
    packs: z.array(packSchema).min(1).max(2),
    patches: z.array(frameSchema.extend({ fromSha256: sha256Schema, toSha256: sha256Schema })),
    schemaVersion: z.literal(4),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: 'custom', message });
    const packs = new Map(manifest.packs.map((pack) => [pack.sha256, pack]));
    if (packs.size !== manifest.packs.length) bad('Duplicate pack');
    const sizes = new Map<string, number>();
    for (const file of manifest.tree) {
      if (!manifest.objects[file.sha256]) bad(`Missing object ${file.sha256}`);
      if (file.size > 256 * 1024 ** 2 || !Number.isSafeInteger(file.size)) bad('File too large');
      if (sizes.has(file.sha256) && sizes.get(file.sha256) !== file.size) bad('Conflicting sizes');
      sizes.set(file.sha256, file.size);
    }
    if (Object.keys(manifest.objects).some((hash) => !sizes.has(hash))) bad('Unreferenced object');
    if (new Set(Object.values(manifest.objects).map((frame) => frame.packSha256)).size !== 1)
      bad('Objects must share one pack');
    for (const patch of manifest.patches) {
      if (!sizes.has(patch.toSha256)) bad('Patch target missing');
    }
    const frames = [...Object.values(manifest.objects), ...manifest.patches].sort(
      (a, b) => a.packSha256.localeCompare(b.packSha256) || a.offset - b.offset,
    );
    let previous: (typeof frames)[number] | undefined;
    for (const frame of frames) {
      const pack = packs.get(frame.packSha256);
      const end = frame.offset + frame.length;
      if (!pack || !Number.isSafeInteger(end) || end > pack.size) bad('Frame outside pack');
      if (
        previous?.packSha256 === frame.packSha256 &&
        previous.offset + previous.length > frame.offset
      )
        bad('Overlapping frames');
      previous = frame;
    }
  });

export const coreManifestSchema = z.union([coreManifestV3Schema, coreManifestV4Schema]);
export type CoreManifestV3 = z.infer<typeof coreManifestV3Schema>;
export type CoreManifestV4 = z.infer<typeof coreManifestV4Schema>;
export type CoreManifest = CoreManifestV3 | CoreManifestV4;
export type PackFrame = z.infer<typeof frameSchema>;
export type CorePatch = z.infer<typeof corePatchSchema>;
export type RendererArtifact = z.infer<typeof rendererArtifactSchema>;
export type RendererTreeFile = z.infer<typeof rendererTreeFileSchema>;

export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

export const verifyManifestSignature = (
  manifest: { signature: string },
  publicKeyPem: string,
): boolean => {
  const { signature, ...unsigned } = manifest;
  try {
    return cryptoVerify(
      null,
      Buffer.from(canonicalJson(unsigned)),
      publicKeyPem,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
};

export const isValidManifestShape = (value: unknown): value is CoreManifest =>
  coreManifestSchema.safeParse(value).success;

export const sha256File = (content: Buffer): string =>
  createHash('sha256').update(content).digest('hex');

export const findMissingEntryAssets = (
  html: string,
  exists: (relPath: string) => boolean,
): string[] => {
  const refs = [...html.matchAll(/(?:src|href)="\.?\/([^"]+\.(?:m?js|css))"/g)].map(
    (match) => match[1],
  );
  const missing = refs.filter((ref) => !exists(ref));
  if (!refs.some((ref) => /\.m?js$/.test(ref))) missing.push('<no script referenced>');
  return missing;
};

export const readBuiltinManifest = (shell: ShellGlobal): CoreManifest | null => {
  if (shell.source === 'builtin') return shell.manifest;
  try {
    const raw = JSON.parse(readFileSync(path.join(shell.builtinDir, 'manifest.json'), 'utf8'));
    return builtinManifestSchema.parse(raw);
  } catch {
    return null;
  }
};
