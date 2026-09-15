import { describe, expect, it } from 'vitest';

import { resolveAttachmentType } from './resolveAttachmentType';

describe('resolveAttachmentType', () => {
  it('maps a MIME prefix to its attachment type', () => {
    expect(resolveAttachmentType('photo.png', 'image/png')).toBe('image');
    expect(resolveAttachmentType('clip.mp4', 'video/mp4')).toBe('video');
    expect(resolveAttachmentType('voice.mp3', 'audio/mpeg')).toBe('audio');
  });

  it('treats an unrecognized MIME type as a generic file', () => {
    expect(resolveAttachmentType('report.pdf', 'application/pdf')).toBe('file');
  });

  it('accepts an uppercase MIME type', () => {
    expect(resolveAttachmentType('photo.png', 'IMAGE/PNG')).toBe('image');
  });

  it('reads a legacy row that stores a bare extension in fileType', () => {
    expect(resolveAttachmentType('whatever', 'png')).toBe('image');
    expect(resolveAttachmentType('whatever', 'MOV')).toBe('video');
  });

  it('falls back to the filename extension when fileType is missing', () => {
    expect(resolveAttachmentType('photo.JPG')).toBe('image');
    expect(resolveAttachmentType('clip.webm')).toBe('video');
    expect(resolveAttachmentType('voice.flac')).toBe('audio');
    expect(resolveAttachmentType('archive.zip')).toBe('file');
  });

  it('lets the MIME type win over a contradicting extension', () => {
    expect(resolveAttachmentType('report.pdf', 'image/png')).toBe('image');
  });

  it('returns a generic file for a name with no extension and no fileType', () => {
    expect(resolveAttachmentType('README')).toBe('file');
  });

  it('does not treat a dotless name as its own extension', () => {
    // `split('.').pop()` yields the whole string when there is no dot — a name
    // that happens to equal a known extension must not be misread as one.
    expect(resolveAttachmentType('png')).toBe('file');
  });
});
