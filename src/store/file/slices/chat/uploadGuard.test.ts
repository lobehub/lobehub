import { describe, expect, it } from 'vitest';

import { filterSupportedChatUploadFiles, isSupportedChatUploadFile } from './uploadGuard';

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
