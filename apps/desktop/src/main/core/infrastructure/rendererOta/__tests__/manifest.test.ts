import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  diffManifest,
  isValidManifestShape,
  patchNumber,
  type RendererManifest,
  verifyManifestSignature,
} from '../manifest';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();

const signManifest = (unsigned: Omit<RendererManifest, 'signature'>): RendererManifest => ({
  ...unsigned,
  signature: sign(null, Buffer.from(canonicalJson(unsigned)), privateKey).toString('base64'),
});

const baseManifest = (): RendererManifest =>
  signManifest({
    appVersion: '1.147.0',
    files: [
      { path: 'apps/desktop/index.html', sha256: 'a'.repeat(64), size: 10 },
      { path: 'assets/entry-abc.js', sha256: 'b'.repeat(64), size: 20 },
    ],
    mainHash: 'f'.repeat(64),
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
    manifest.files[0].sha256 = 'c'.repeat(64);
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
  it('accepts a well-formed manifest', () => {
    expect(isValidManifestShape(baseManifest())).toBe(true);
  });

  it('rejects path traversal', () => {
    const manifest = baseManifest();
    manifest.files[0].path = '../evil.js';
    expect(isValidManifestShape(manifest)).toBe(false);
  });

  it('rejects absolute paths', () => {
    const manifest = baseManifest();
    manifest.files[0].path = '/etc/passwd';
    expect(isValidManifestShape(manifest)).toBe(false);
  });

  it('rejects non r<N> versions', () => {
    expect(isValidManifestShape({ ...baseManifest(), version: '1.2.3' })).toBe(false);
  });

  it('accepts a signed tree delta', () => {
    const manifest = baseManifest();
    manifest.deltas = [
      {
        fromVersion: 'r0',
        ops: [
          { op: 'copy', path: 'apps/desktop/index.html', sha256: 'a'.repeat(64) },
          {
            fromSha256: 'b'.repeat(64),
            op: 'patch',
            patchSha256: 'c'.repeat(64),
            patchSize: 12,
            path: 'assets/entry-abc.js',
            sha256: 'd'.repeat(64),
            size: 20,
          },
        ],
      },
    ];
    expect(isValidManifestShape(manifest)).toBe(true);
  });
});

describe('diffManifest', () => {
  it('splits files into reusable and missing by content hash', () => {
    const manifest = baseManifest();
    const local = new Map([['/old/apps/desktop/index.html', 'a'.repeat(64)]]);

    const { missing, reusable } = diffManifest(manifest, local);

    expect(reusable).toEqual([
      { file: manifest.files[0], localPath: '/old/apps/desktop/index.html' },
    ]);
    expect(missing).toEqual([manifest.files[1]]);
  });

  it('reuses by hash regardless of local path', () => {
    const manifest = baseManifest();
    const local = new Map([['/anywhere/renamed.js', 'b'.repeat(64)]]);

    const { missing, reusable } = diffManifest(manifest, local);

    expect(reusable[0].file.path).toBe('assets/entry-abc.js');
    expect(missing).toEqual([manifest.files[0]]);
  });
});

describe('patchNumber', () => {
  it('parses r<N>', () => {
    expect(patchNumber('r12')).toBe(12);
  });
});
