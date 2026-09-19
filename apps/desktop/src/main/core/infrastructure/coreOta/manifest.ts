import { createHash, verify as cryptoVerify } from 'node:crypto';

import * as z from 'zod/v4';

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

export const coreManifestSchema = z
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

export type CoreManifest = z.infer<typeof coreManifestSchema>;
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
