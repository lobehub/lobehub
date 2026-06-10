import { describe, expect, it } from 'vitest';

import { isHtmlFile } from './fileType';

describe('isHtmlFile', () => {
  it('detects HTML files by MIME type', () => {
    expect(isHtmlFile({ fileType: 'text/html' })).toBe(true);
    expect(isHtmlFile({ fileType: 'text/html; charset=utf-8' })).toBe(true);
    expect(isHtmlFile({ fileType: 'application/xhtml+xml' })).toBe(true);
  });

  it('detects HTML files by filename or path extension', () => {
    expect(isHtmlFile({ fileName: 'preview.HTML' })).toBe(true);
    expect(isHtmlFile({ path: '/tmp/demo.htm' })).toBe(true);
    expect(isHtmlFile({ fileName: 'preview', path: '/tmp/demo.html' })).toBe(true);
  });

  it('rejects non-HTML files', () => {
    expect(isHtmlFile({ fileName: 'preview.tsx', fileType: 'text/plain' })).toBe(false);
    expect(isHtmlFile({ path: '/tmp/html-preview.ts' })).toBe(false);
    expect(isHtmlFile({})).toBe(false);
  });
});
