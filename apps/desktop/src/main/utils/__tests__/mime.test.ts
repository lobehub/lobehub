import { describe, expect, it } from 'vitest';

import { getExportMimeType, resolveLocalFileMimeType } from '../mime';

describe('getExportMimeType', () => {
  it('returns the whitelisted MIME for a known extension', () => {
    expect(getExportMimeType('/abs/path/App.tsx')).toBe('text/plain; charset=utf-8');
    expect(getExportMimeType('icon.png')).toBe('image/png');
  });

  it('returns undefined for unmapped extensions', () => {
    expect(getExportMimeType('.releaserc.cjs')).toBeUndefined();
    expect(getExportMimeType('Makefile')).toBeUndefined();
  });
});

describe('resolveLocalFileMimeType', () => {
  it('uses the whitelist for known source extensions', () => {
    expect(resolveLocalFileMimeType('/repo/App.tsx', Buffer.from(''))).toBe(
      'text/plain; charset=utf-8',
    );
    expect(resolveLocalFileMimeType('/repo/data.json', Buffer.from('{}'))).toBe(
      'application/json; charset=utf-8',
    );
  });

  it('serves preview-only image formats with their image MIME', () => {
    expect(resolveLocalFileMimeType('/repo/photo.heic', Buffer.from([0xff, 0xd8]))).toBe(
      'image/heic',
    );
    expect(resolveLocalFileMimeType('/repo/diagram.bmp', Buffer.from([0x42, 0x4d]))).toBe(
      'image/bmp',
    );
  });

  it('treats unmapped text-looking files (.cjs/.mjs) as text via the sniff fallback', () => {
    const cjsContent = Buffer.from(`module.exports = { plugins: ['@semantic-release/npm'] };\n`);
    expect(resolveLocalFileMimeType('/repo/.releaserc.cjs', cjsContent)).toBe(
      'text/plain; charset=utf-8',
    );

    const mjsContent = Buffer.from(`export default { settings: ['emoji'] };\n`);
    expect(resolveLocalFileMimeType('/repo/.remarkrc.mjs', mjsContent)).toBe(
      'text/plain; charset=utf-8',
    );
  });

  it('treats no-extension config files as text via the sniff fallback', () => {
    const editorconfig = Buffer.from('root = true\n[*]\nindent_style = space\n');
    expect(resolveLocalFileMimeType('/repo/.editorconfig', editorconfig)).toBe(
      'text/plain; charset=utf-8',
    );
  });

  it('falls back to application/octet-stream when the sniff detects binary data', () => {
    // Embedded null byte → sniff classifies as binary.
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]);
    expect(resolveLocalFileMimeType('/repo/strange.blob', binary)).toBe('application/octet-stream');
  });

  it('forces known-binary extensions to octet-stream even when the prefix sniffs as text', () => {
    // PDF header + xref + dictionary is pure ASCII for the first few KB —
    // sniff would classify this as text without the extension short-circuit.
    const pdfPrintablePrefix = Buffer.from(
      '%PDF-1.7\n%\xC4\xE5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    );
    expect(resolveLocalFileMimeType('/repo/manual.pdf', pdfPrintablePrefix)).toBe(
      'application/octet-stream',
    );

    // No null bytes in the first 8KB; without the short-circuit this would
    // also be misclassified as text.
    const fakeZipPrefix = Buffer.from('PK\x03\x04' + 'A'.repeat(64));
    expect(resolveLocalFileMimeType('/repo/bundle.zip', fakeZipPrefix)).toBe(
      'application/octet-stream',
    );

    const fakeMp3Prefix = Buffer.from('ID3' + 'A'.repeat(64));
    expect(resolveLocalFileMimeType('/repo/song.mp3', fakeMp3Prefix)).toBe(
      'application/octet-stream',
    );
  });
});
