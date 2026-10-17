import { describe, expect, it } from 'vitest';

import { evidenceTypeForStoredFile } from '../evidenceMedium';

describe('evidenceTypeForStoredFile', () => {
  it('stores a GIF labelled as video or screenshot as a gif', () => {
    expect(evidenceTypeForStoredFile('video', { fileType: 'image/gif', name: 'rename.gif' })).toBe(
      'gif',
    );
    expect(evidenceTypeForStoredFile('screenshot', { fileType: 'image/gif' })).toBe('gif');
    expect(evidenceTypeForStoredFile('video', { fileType: null, name: 'Rename.GIF' })).toBe('gif');
  });

  it('keeps the declared type for anything that is not a GIF file', () => {
    expect(evidenceTypeForStoredFile('video', { fileType: 'video/mp4', name: 'rename.mp4' })).toBe(
      'video',
    );
    expect(evidenceTypeForStoredFile('screenshot', { fileType: 'image/png' })).toBe('screenshot');
    expect(evidenceTypeForStoredFile('text', { fileType: 'image/gif' })).toBe('text');
    expect(evidenceTypeForStoredFile('video', undefined)).toBe('video');
  });
});
