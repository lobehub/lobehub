import { createHash, verify as cryptoVerify } from 'node:crypto';

import * as z from 'zod/v4';

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const versionSchema = z.string().regex(/^r\d+$/);
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

export const rendererPatchSchema = z
  .object({
    fromSha256: sha256Schema,
    patchSha256: sha256Schema,
    toSha256: sha256Schema,
  })
  .strict();

export const rendererDeltaSchema = z
  .object({
    fromVersion: versionSchema,
    pack: rendererArtifactSchema,
  })
  .strict();

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

export const rendererFullPackMetadataSchema = z
  .object({
    kind: z.literal('full'),
    packVersion: z.literal(1),
    tree: rendererTreeSchema,
    version: versionSchema,
  })
  .strict();

export const rendererDeltaPackMetadataSchema = z
  .object({
    fromVersion: versionSchema,
    kind: z.literal('delta'),
    objects: z.array(sha256Schema),
    packVersion: z.literal(1),
    patches: z.array(rendererPatchSchema),
    tree: rendererTreeSchema,
    version: versionSchema,
  })
  .strict()
  .superRefine((metadata, ctx) => {
    if (metadata.fromVersion === metadata.version) {
      ctx.addIssue({ code: 'custom', message: 'delta base and target versions must differ' });
    }

    const targets = new Set(metadata.tree.map((file) => file.sha256));
    const objectHashes = new Set<string>();
    for (const sha256 of metadata.objects) {
      if (objectHashes.has(sha256)) {
        ctx.addIssue({ code: 'custom', message: `duplicate renderer object: ${sha256}` });
      }
      if (!targets.has(sha256)) {
        ctx.addIssue({
          code: 'custom',
          message: `renderer object is not in target tree: ${sha256}`,
        });
      }
      objectHashes.add(sha256);
    }

    const patchTargets = new Set<string>();
    for (const patch of metadata.patches) {
      if (patchTargets.has(patch.toSha256)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate renderer patch target: ${patch.toSha256}`,
        });
      }
      if (objectHashes.has(patch.toSha256)) {
        ctx.addIssue({
          code: 'custom',
          message: `renderer target has both object and patch: ${patch.toSha256}`,
        });
      }
      if (!targets.has(patch.toSha256)) {
        ctx.addIssue({
          code: 'custom',
          message: `renderer patch target is not in target tree: ${patch.toSha256}`,
        });
      }
      patchTargets.add(patch.toSha256);
    }
  });

export const rendererPackMetadataSchema = z.discriminatedUnion('kind', [
  rendererFullPackMetadataSchema,
  rendererDeltaPackMetadataSchema,
]);

export const rendererManifestSchema = z
  .object({
    appVersion: z.string().min(1),
    deltas: z.array(rendererDeltaSchema).optional(),
    full: rendererArtifactSchema,
    mainHash: sha256Schema,
    schemaVersion: z.literal(2),
    signature: z.string().min(1),
    version: versionSchema,
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const fromVersions = new Set<string>();
    for (const delta of manifest.deltas ?? []) {
      if (fromVersions.has(delta.fromVersion)) {
        ctx.addIssue({ code: 'custom', message: `duplicate delta base: ${delta.fromVersion}` });
      }
      fromVersions.add(delta.fromVersion);
    }
  });

export type RendererArtifact = z.infer<typeof rendererArtifactSchema>;
export type RendererDelta = z.infer<typeof rendererDeltaSchema>;
export type RendererDeltaPackMetadata = z.infer<typeof rendererDeltaPackMetadataSchema>;
export type RendererFullPackMetadata = z.infer<typeof rendererFullPackMetadataSchema>;
export type RendererManifest = z.infer<typeof rendererManifestSchema>;
export type RendererPackMetadata = z.infer<typeof rendererPackMetadataSchema>;
export type RendererPatch = z.infer<typeof rendererPatchSchema>;
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
  manifest: RendererManifest,
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

export const isValidManifestShape = (value: unknown): value is RendererManifest =>
  rendererManifestSchema.safeParse(value).success;

export const patchNumber = (version: string): number => Number(version.slice(1));

export const sha256File = (content: Buffer): string =>
  createHash('sha256').update(content).digest('hex');

/**
 * Static integrity check on a staged tree's entry html: every referenced local
 * js/css must exist, and at least one script must be referenced.
 */
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
