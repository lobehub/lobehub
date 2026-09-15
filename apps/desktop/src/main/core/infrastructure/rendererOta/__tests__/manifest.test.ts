import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  isValidManifestShape,
  patchNumber,
  type RendererManifest,
  verifyManifestSignature,
} from '../manifest';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
const sha = (character: string) => character.repeat(64);

const signManifest = (unsigned: Omit<RendererManifest, 'signature'>): RendererManifest => ({
  ...unsigned,
  signature: sign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString('base64'),
});

const baseManifest = (): RendererManifest =>
  signManifest({
    appVersion: '1.147.0',
    full: { path: `packs/${sha('c')}.zip`, sha256: sha('c'), size: 30 },
    mainHash: sha('f'),
    schemaVersion: 2,
    version: 'r3',
  });

describe('canonicalJson', () => {
  it('sorts keys deterministically', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });
});

describe('verifyManifestSignature', () => {
  it('accepts a valid signature', () => {
    expect(verifyManifestSignature(baseManifest(), publicKeyPem)).toBe(true);
  });

  it('rejects a tampered manifest', () => {
    const manifest = baseManifest();
    manifest.full.size += 1;
    expect(verifyManifestSignature(manifest, publicKeyPem)).toBe(false);
  });

  it('rejects a foreign key', () => {
    const other = generateKeyPairSync('ed25519')
      .publicKey.export({ format: 'pem', type: 'spki' })
      .toString();
    expect(verifyManifestSignature(baseManifest(), other)).toBe(false);
  });
});

describe('isValidManifestShape', () => {
  it('accepts a well-formed V2 manifest', () => {
    expect(isValidManifestShape(baseManifest())).toBe(true);
  });

  it('rejects the V1 CAS manifest shape', () => {
    const { full: _full, schemaVersion: _schemaVersion, ...rest } = baseManifest();
    expect(
      isValidManifestShape({
        ...rest,
        files: [{ path: 'index.html', sha256: sha('a'), size: 10 }],
      }),
    ).toBe(false);
  });

  it('rejects unsafe artifact paths', () => {
    const artifactTraversal = baseManifest();
    artifactTraversal.full.path = '../foreign.zip';
    expect(isValidManifestShape(artifactTraversal)).toBe(false);
  });

  it('rejects a pack path that does not match its content hash', () => {
    const manifest = baseManifest();
    manifest.full.path = `packs/${sha('b')}.zip`;
    expect(isValidManifestShape(manifest)).toBe(false);
  });

  it('rejects non r<N> versions', () => {
    expect(isValidManifestShape({ ...baseManifest(), version: '1.2.3' })).toBe(false);
  });

  it('accepts a signed V2 delta pack', () => {
    const manifest = baseManifest();
    manifest.deltas = [
      {
        fromVersion: 'r0',
        pack: { path: `packs/${sha('d')}.zip`, sha256: sha('d'), size: 12 },
      },
    ];
    expect(isValidManifestShape(manifest)).toBe(true);
  });

  it('rejects a target tree in the outer manifest', () => {
    expect(
      isValidManifestShape({
        ...baseManifest(),
        tree: [{ path: 'index.html', sha256: sha('a'), size: 10 }],
      }),
    ).toBe(false);
  });
});

describe('patchNumber', () => {
  it('parses r<N>', () => {
    expect(patchNumber('r12')).toBe(12);
  });
});
