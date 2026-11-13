import type { ArtboardFrame } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { liveFrameKey } from './visibleFrames';

const frame = (id: string, x: number, y = 0) =>
  ({ groupId: 'g', id, source: { fileId: 'f', kind: 'image' }, title: id, x, y }) as ArtboardFrame;

const frames = [frame('a', 0), frame('b', 840), frame('c', 4000)];
const screen = { height: 800, width: 1200 };

describe('liveFrameKey', () => {
  it('loads only the frames that overlap the viewport', () => {
    expect(liveFrameKey(frames, { ...screen, k: 1, x: 0, y: 0 })).toBe('a b');
    expect(liveFrameKey(frames, { ...screen, k: 1, x: -700, y: 0 })).toBe('b');
  });

  it('loads nothing while frames are too small to read', () => {
    expect(liveFrameKey(frames, { ...screen, k: 0.3, x: 0, y: 0 })).toBe('');
  });
});
