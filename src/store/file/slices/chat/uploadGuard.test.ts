import { describe, expect, it } from 'vitest';

import {
  audioMimeFromExtension,
  filterSupportedChatUploadFiles,
  isSupportedChatUploadFile,
} from './uploadGuard';

describe('isSupportedChatUploadFile', () => {
  it('accepts supported chat image formats', () => {
    expect(isSupportedChatUploadFile(new File(['image'], 'image.png', { type: 'image/png' }))).toBe(
      true,
    );
    expect(
      isSupportedChatUploadFile(new File(['image'], 'image.webp', { type: 'image/webp' })),
    ).toBe(true);
  });

  it('rejects unsupported image formats before upload', () => {
    expect(
      isSupportedChatUploadFile(new File(['<svg />'], 'icon.svg', { type: 'image/svg+xml' })),
    ).toBe(false);
    expect(
      isSupportedChatUploadFile(new File(['image'], 'photo.heic', { type: 'image/heic' })),
    ).toBe(false);
  });

  it('accepts supported document formats', () => {
    expect(
      isSupportedChatUploadFile(
        new File(['document'], 'document.pdf', { type: 'application/pdf' }),
      ),
    ).toBe(true);
    expect(
      isSupportedChatUploadFile(new File(['{}'], 'data.json', { type: 'application/json' })),
    ).toBe(true);
  });

  it('rejects unsupported archive formats before upload', () => {
    expect(
      isSupportedChatUploadFile(new File(['zip'], 'archive.zip', { type: 'application/zip' })),
    ).toBe(false);
  });

  it('accepts audio formats (model-level gating happens in the upload UI)', () => {
    expect(isSupportedChatUploadFile(new File(['a'], 'voice.mp3', { type: 'audio/mpeg' }))).toBe(
      true,
    );
    // .m4a often reports a non-audio or empty mime — fall back to the extension.
    expect(isSupportedChatUploadFile(new File(['a'], 'voice.m4a', { type: '' }))).toBe(true);
    expect(isSupportedChatUploadFile(new File(['a'], 'voice.wav', { type: 'audio/wav' }))).toBe(
      true,
    );
  });
});

describe('audioMimeFromExtension', () => {
  it('maps known audio extensions to a canonical audio mime', () => {
    expect(audioMimeFromExtension('voice.m4a')).toBe('audio/mp4');
    expect(audioMimeFromExtension('song.mp3')).toBe('audio/mpeg');
    expect(audioMimeFromExtension('clip.WAV')).toBe('audio/wav');
    expect(audioMimeFromExtension('note.opus')).toBe('audio/opus');
  });

  it('returns undefined for non-audio extensions', () => {
    expect(audioMimeFromExtension('movie.mp4')).toBeUndefined();
    expect(audioMimeFromExtension('doc.pdf')).toBeUndefined();
    expect(audioMimeFromExtension('noext')).toBeUndefined();
  });
});

describe('filterSupportedChatUploadFiles', () => {
  it('splits supported and unsupported files by default', () => {
    const png = new File(['image'], 'image.png', { type: 'image/png' });
    const zip = new File(['zip'], 'archive.zip', { type: 'application/zip' });

    const { supportedFiles, unsupportedFiles } = filterSupportedChatUploadFiles([png, zip]);

    expect(supportedFiles).toEqual([png]);
    expect(unsupportedFiles).toEqual([zip]);
  });
});
