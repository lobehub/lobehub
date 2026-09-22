import { unzip } from 'fflate';

import { type RendererPackMetadata, rendererPackMetadataSchema, sha256File } from './manifest';

const PACK_METADATA_ENTRY = 'meta.json';
const PACK_CONTENT_ENTRY = /^(?:objects|patches)\/([0-9a-f]{64})$/;

type PackExpectation =
  { kind: 'full'; version: string } | { fromVersion: string; kind: 'delta'; version: string };

const expectedContentEntries = (metadata: RendererPackMetadata): Set<string> => {
  if (metadata.kind === 'full') {
    return new Set(metadata.tree.map((file) => `objects/${file.sha256}`));
  }
  return new Set([
    ...metadata.objects.map((sha256) => `objects/${sha256}`),
    ...metadata.patches.map((patch) => `patches/${patch.patchSha256}`),
  ]);
};

const matchesExpectation = (metadata: RendererPackMetadata, expected: PackExpectation): boolean =>
  metadata.kind === expected.kind &&
  metadata.version === expected.version &&
  (metadata.kind === 'full' ||
    (expected.kind === 'delta' && metadata.fromVersion === expected.fromVersion));

const unzipPack = (content: Buffer) =>
  new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(new Uint8Array(content), (error, unpacked) => {
      if (error) reject(error);
      else resolve(unpacked);
    });
  });

export const decodeRendererPack = async (
  content: Buffer,
  expected: PackExpectation,
): Promise<{ entries: Map<string, Buffer>; metadata: RendererPackMetadata }> => {
  const unpacked = await unzipPack(content);
  const rawMetadata = unpacked[PACK_METADATA_ENTRY];
  if (!rawMetadata) throw new Error('Renderer OTA pack metadata missing');

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(rawMetadata).toString('utf8'));
  } catch {
    throw new Error('Renderer OTA pack metadata invalid');
  }
  const result = rendererPackMetadataSchema.safeParse(parsed);
  if (!result.success || !matchesExpectation(result.data, expected)) {
    throw new Error('Renderer OTA pack metadata invalid');
  }

  const metadata = result.data;
  const expectedEntries = expectedContentEntries(metadata);
  const names = Object.keys(unpacked).filter((name) => name !== PACK_METADATA_ENTRY);
  if (names.length !== expectedEntries.size || names.some((name) => !expectedEntries.has(name))) {
    throw new Error('Renderer OTA pack entries do not match metadata');
  }

  const entries = new Map<string, Buffer>();
  for (const name of names) {
    const match = PACK_CONTENT_ENTRY.exec(name);
    const value = Buffer.from(unpacked[name]);
    if (!match || sha256File(value) !== match[1]) {
      throw new Error(`Renderer OTA pack entry invalid: ${name}`);
    }
    entries.set(name, value);
  }
  return { entries, metadata };
};
