import { createHash, verify as cryptoVerify } from 'node:crypto';

export interface RendererManifestFile {
  path: string;
  sha256: string;
  size: number;
}

export interface RendererManifest {
  appVersion: string;
  files: RendererManifestFile[];
  mainHash: string;
  signature: string;
  version: string;
}

export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

export const verifyManifestSignature = (
  manifest: RendererManifest,
  publicKeyPem: string,
): boolean => {
  const { signature, ...unsigned } = manifest;
  if (!signature) return false;
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

export const isValidManifestShape = (value: unknown): value is RendererManifest => {
  const m = value as RendererManifest;
  return (
    !!m &&
    typeof m.version === 'string' &&
    /^r\d+$/.test(m.version) &&
    typeof m.mainHash === 'string' &&
    typeof m.appVersion === 'string' &&
    typeof m.signature === 'string' &&
    Array.isArray(m.files) &&
    m.files.every(
      (f) =>
        typeof f?.path === 'string' &&
        !f.path.includes('..') &&
        !f.path.startsWith('/') &&
        /^[0-9a-f]{64}$/.test(f?.sha256 ?? '') &&
        typeof f?.size === 'number',
    )
  );
};

export const patchNumber = (version: string): number => Number(version.slice(1));

export const sha256File = (content: Buffer): string =>
  createHash('sha256').update(content).digest('hex');

/**
 * Static integrity check on a staged tree's entry html: every referenced local
 * js/css must exist, and at least one script must be referenced — a bundle
 * whose entry chunk is missing would otherwise only surface as a boot-check
 * timeout after the swap.
 */
export const findMissingEntryAssets = (
  html: string,
  exists: (relPath: string) => boolean,
): string[] => {
  const refs = [...html.matchAll(/(?:src|href)="\.?\/([^"]+\.(?:m?js|css))"/g)].map((m) => m[1]);
  const missing = refs.filter((ref) => !exists(ref));
  if (!refs.some((ref) => /\.m?js$/.test(ref))) missing.push('<no script referenced>');
  return missing;
};

/** Split manifest files into reusable-from-local (by hash) and missing (to download). */
export const diffManifest = (
  manifest: RendererManifest,
  localHashes: Map<string, string>,
): {
  missing: RendererManifestFile[];
  reusable: Array<{ file: RendererManifestFile; localPath: string }>;
} => {
  const missing: RendererManifestFile[] = [];
  const reusable: Array<{ file: RendererManifestFile; localPath: string }> = [];

  const byHash = new Map<string, string>();
  for (const [localPath, hash] of localHashes) {
    if (!byHash.has(hash)) byHash.set(hash, localPath);
  }

  for (const file of manifest.files) {
    const localPath = byHash.get(file.sha256);
    if (localPath) reusable.push({ file, localPath });
    else missing.push(file);
  }

  return { missing, reusable };
};
