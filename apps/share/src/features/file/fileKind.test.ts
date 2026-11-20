import { describe, expect, it } from 'vitest';

import { getSharedFileKind } from './fileKind';

describe('getSharedFileKind', () => {
  it('classifies by MIME type first', () => {
    expect(getSharedFileKind({ fileType: 'video/mp4', name: 'intro' })).toBe('video');
    expect(getSharedFileKind({ fileType: 'audio/mpeg', name: 'a.bin' })).toBe('audio');
    expect(getSharedFileKind({ fileType: 'image/png', name: 'x' })).toBe('image');
    expect(getSharedFileKind({ fileType: 'application/zip', name: 'x' })).toBe('archive');
  });

  it('falls back to the extension when the type is generic', () => {
    expect(getSharedFileKind({ fileType: 'application/octet-stream', name: 'Clip.MOV' })).toBe(
      'video',
    );
    expect(getSharedFileKind({ fileType: '', name: 'song.flac' })).toBe('audio');
    expect(getSharedFileKind({ name: 'bundle.tar.gz' })).toBe('archive');
  });

  it('sends everything else to the reader', () => {
    expect(getSharedFileKind({ fileType: 'application/pdf', name: 'r.pdf' })).toBe('document');
    expect(getSharedFileKind({ fileType: 'text/markdown', name: 'notes.md' })).toBe('document');
    expect(getSharedFileKind({ name: 'main.py' })).toBe('document');
  });
});
