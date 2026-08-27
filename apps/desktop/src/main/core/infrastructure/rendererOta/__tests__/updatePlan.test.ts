import { describe, expect, it } from 'vitest';

import type { RendererDelta, RendererDeltaPackMetadata, RendererManifest } from '../manifest';
import { canApplyDelta, indexLocalByHash, pickDelta } from '../updatePlan';

const sha = (character: string) => character.repeat(64);

const delta = (fromVersion: string): RendererDelta => ({
  fromVersion,
  pack: { path: `packs/${sha('a')}.zip`, sha256: sha('a'), size: 10 },
});

const manifest = (deltas?: RendererManifest['deltas']): RendererManifest => ({
  appVersion: '1.0.0',
  deltas,
  full: { path: `packs/${sha('f')}.zip`, sha256: sha('f'), size: 20 },
  mainHash: sha('m'),
  schemaVersion: 2,
  signature: 'sig',
  version: 'r2',
});

const metadata = (): RendererDeltaPackMetadata => ({
  fromVersion: 'r0',
  kind: 'delta',
  objects: [sha('n')],
  packVersion: 1,
  patches: [{ fromSha256: sha('o'), patchSha256: sha('b'), toSha256: sha('t') }],
  tree: [
    { path: 'unchanged.js', sha256: sha('u'), size: 1 },
    { path: 'patched.js', sha256: sha('t'), size: 1 },
    { path: 'new.js', sha256: sha('n'), size: 1 },
  ],
  version: 'r2',
});

describe('pickDelta', () => {
  it('selects only the pack matching the local version', () => {
    const r0 = delta('r0');
    const r1 = delta('r1');
    expect(pickDelta(manifest([r0, r1]), 'r0')).toBe(r0);
    expect(pickDelta(manifest([r0, r1]), 'r3')).toBeUndefined();
  });
});

describe('canApplyDelta', () => {
  it('accepts locally reusable files plus declared full and patch payloads', () => {
    const byHash = indexLocalByHash(
      new Map([
        ['/old/unchanged.js', sha('u')],
        ['/old/base.js', sha('o')],
      ]),
    );
    expect(canApplyDelta(metadata(), byHash)).toBe(true);
  });

  it('requires every target to be locally reusable or reconstructable from the pack', () => {
    const byHash = indexLocalByHash(new Map([['/old/unchanged.js', sha('u')]]));
    expect(canApplyDelta(metadata(), byHash)).toBe(false);
  });
});
