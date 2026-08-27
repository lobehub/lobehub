import { describe, expect, it } from 'vitest';

import { canApplyDelta, indexLocalByHash, pickDelta } from '../deltaFeed';
import type { RendererDelta, RendererManifest } from '../manifest';

const sha = (ch: string) => ch.repeat(64);

const manifest = (deltas?: RendererManifest['deltas']): RendererManifest => ({
  appVersion: '1.0.0',
  deltas,
  files: [{ path: 'a.js', sha256: sha('a'), size: 1 }],
  mainHash: sha('m'),
  signature: 'sig',
  version: 'r2',
});

const delta = (fromVersion: string, fromSha256: string): RendererDelta => ({
  fromVersion,
  ops: [
    {
      fromSha256,
      op: 'patch',
      patchSha256: sha('p'),
      patchSize: 10,
      path: 'a.js',
      sha256: sha('n'),
      size: 20,
    },
  ],
});

describe('pickDelta', () => {
  it('selects the delta that matches the local version', () => {
    const r0 = delta('r0', sha('o'));
    const r1 = delta('r1', sha('x'));
    expect(pickDelta(manifest([r0, r1]), 'r0')).toBe(r0);
    expect(pickDelta(manifest([r0, r1]), 'r3')).toBeUndefined();
  });
});

describe('canApplyDelta', () => {
  it('requires every copy/patch base hash to exist locally', () => {
    const d = delta('r0', sha('o'));
    expect(canApplyDelta(d, indexLocalByHash(new Map([['/old', sha('o')]])))).toBe(true);
    expect(canApplyDelta(d, indexLocalByHash(new Map([['/old', sha('z')]])))).toBe(false);
  });
});
